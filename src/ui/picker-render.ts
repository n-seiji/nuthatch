import { homedir } from "node:os";
import { truncateToWidthKeepingTail } from "../domain/display-width.ts";
import {
  buildFrame,
  GUTTER,
  lineWidth,
  truncateLineToWidth,
  type StyledLine,
  wrapInBox,
} from "./picker-frame.ts";
import { buildDisplayRows, rawBranchColumnWidth, type DisplayRow } from "./picker-layout.ts";
import { headerLine, footerLine, ruleLine } from "./picker-chrome.ts";
import {
  constrainRowColumnWidths,
  footerHintForWidth,
  isNarrowTerminal,
} from "./picker-side-by-side.ts";
import type { PickerSnapshot } from "./picker-store.ts";
import type { PickerMode } from "./picker-types.ts";
import { computeViewport, rowBudget } from "./picker-viewport.ts";
import { buildActionPanelRows, buildConfirmPanelRows, SIDE_PANEL_WIDTH } from "./side-panel.ts";

const QUERY_PREFIX = "hop: ";

/**
 * Unlike every other line, the query line must keep its *tail* when
 * truncated, not its head -- the user is actively typing at the end of
 * it, so cutting the end off (as picker-frame.ts's generic
 * truncateLineToWidth, applied to every other line, does) would hide the
 * very characters they just typed (Fable-reported). `maxWidth` is the
 * full line's budget; the "hop: " prefix and, for an empty query, the "
 * (type to filter)" hint both come out of it first.
 */
const queryLine = (query: string, maxWidth: number): StyledLine => {
  const hint = query.length === 0 ? " (type to filter)" : "";
  const budget = Math.max(0, maxWidth - QUERY_PREFIX.length - hint.length);
  return [
    { text: QUERY_PREFIX },
    { text: truncateToWidthKeepingTail(query, budget), style: "cyan" },
    { text: hint, style: "dim" },
  ];
};

const hiddenCountLine = (count: number, direction: "above" | "below"): StyledLine | null => {
  if (count === 0) {
    return null;
  }
  const arrow = direction === "above" ? "↑ " : "↓ ";
  const word = direction === "above" ? "above" : "below";
  return [
    {
      text: `${arrow}${count} more ${word} (keep typing to narrow down)`,
      style: "dim",
    },
  ];
};

/**
 * A worktree row: state, branch, kind, path, each in its own color. The
 * selected row keeps those colors and marks itself with a cyan "❯" and the
 * branch name in inverse video, so it reads as selected in light and dark
 * terminals alike (and by the "❯" alone without color).
 */
const candidateRowLine = (
  row: Extract<DisplayRow, { kind: "candidate" }>,
  selected: boolean,
): StyledLine => {
  if (!selected && row.section === "branch") {
    const text = `  ${row.stateText} ${row.branchLabel}  ${row.kindLabel} ${row.pathLabel}`;
    return [{ text, style: "dim" }];
  }
  return [
    selected ? { text: "❯ ", style: "cyan" } : { text: "  " },
    { text: row.stateText, style: row.stateStyle },
    { text: " " },
    selected
      ? { text: row.branchLabel, style: "inverse" }
      : { text: row.branchLabel, style: "bold" },
    { text: "  " },
    { text: row.kindLabel, style: row.kindStyle },
    { text: ` ${row.pathLabel}`, style: selected ? "plain" : "dim" },
  ];
};

const displayRowLine = (row: DisplayRow, clampedIndex: number, width: number): StyledLine =>
  row.kind === "header"
    ? ruleLine(row.label, width)
    : candidateRowLine(row, row.index === clampedIndex);

interface BuildListLinesInput {
  readonly query: string;
  readonly maxWidth: number;
  readonly rows: readonly DisplayRow[];
  readonly clampedIndex: number;
  readonly hiddenAbove: number;
  readonly hiddenBelow: number;
  readonly footerHint: string;
  readonly header: StyledLine;
}

const buildListLines = ({
  query,
  maxWidth,
  rows,
  clampedIndex,
  hiddenAbove,
  hiddenBelow,
  footerHint,
  header,
}: BuildListLinesInput): StyledLine[] => {
  const lines: StyledLine[] = [header, queryLine(query, maxWidth)];
  if (rows.length === 0) {
    lines.push([{ text: "No matches.", style: "dim" }]);
  }
  const above = hiddenCountLine(hiddenAbove, "above");
  if (above !== null) {
    lines.push(above);
  }
  // Section rules stop where the widest row does, so they underline the list instead of the whole terminal.
  const candidateWidths = rows.map((row) =>
    row.kind === "candidate" ? lineWidth(candidateRowLine(row, false)) : 0,
  );
  const ruleWidth = Math.min(maxWidth, Math.max(0, ...candidateWidths));
  for (const row of rows) {
    lines.push(displayRowLine(row, clampedIndex, ruleWidth));
  }
  const below = hiddenCountLine(hiddenBelow, "below");
  if (below !== null) {
    lines.push(below);
  }
  lines.push(footerLine(footerHint));
  return lines;
};

/** The right-column content for the current mode, or null in plain list mode. */
const buildSidePanelLines = (
  mode: PickerMode,
  panelIndex: number,
  busy: boolean,
): StyledLine[] | null => {
  if (mode.kind === "panel") {
    return wrapInBox(
      buildActionPanelRows({
        candidate: mode.candidate,
        panelIndex,
        error: mode.error,
        busy,
      }),
      SIDE_PANEL_WIDTH,
    );
  }
  if (mode.kind === "confirm") {
    return wrapInBox(
      buildConfirmPanelRows({ candidate: mode.candidate, action: mode.action }),
      SIDE_PANEL_WIDTH,
    );
  }
  return null;
};

interface RenderPickerInput {
  readonly snapshot: PickerSnapshot;
  readonly width: number;
  readonly height: number;
  readonly colorEnabled: boolean;
}

/** Pure: builds the full frame string for the current store snapshot + terminal size. Split out from the session wiring so it stays unit-testable without a real terminal. */
export const renderPickerFrame = ({
  snapshot,
  width,
  height,
  colorEnabled: color,
}: RenderPickerInput): string => {
  const { query, candidates, filtered, clampedIndex, mode, panelIndex, busy } = snapshot;
  const narrow = isNarrowTerminal(width);
  const right = buildSidePanelLines(mode, panelIndex, busy);
  // The panel only stacks below the list (consuming vertical rows the list would otherwise use) in narrow terminals; side-by-side it costs no rows.
  const stacked = right !== null && narrow;
  // The list column's own available width: the full terminal width unless the panel sits beside it, in which case the gutter and panel width come out of it first -- rows/footer built wider than this would get line-wrapped by the terminal itself, throwing off rowBudget's row-count estimate (astra/Fable-reported).
  const listColumnWidth =
    right !== null && !stacked ? width - GUTTER.length - SIDE_PANEL_WIDTH : width;
  const stackedPanelRows = stacked && right !== null ? right.length : 0;
  const budget = rowBudget({ terminalHeight: height, stackedPanelRows });
  const viewport = computeViewport(filtered.length, clampedIndex, budget);
  const visible = filtered.slice(viewport.start, viewport.end);
  const columnWidths = constrainRowColumnWidths(rawBranchColumnWidth(visible), listColumnWidth);
  const rows = buildDisplayRows(visible, homedir(), viewport.start, columnWidths);

  const left = buildListLines({
    query,
    maxWidth: listColumnWidth,
    rows,
    clampedIndex,
    hiddenAbove: viewport.hiddenAbove,
    hiddenBelow: viewport.hiddenBelow,
    footerHint: footerHintForWidth(right === null ? "list" : "panel", listColumnWidth),
    header: headerLine(candidates, query.length === 0 ? null : filtered.length),
  }).map((line) => truncateLineToWidth(line, listColumnWidth));

  return buildFrame({ left, right, stacked, colorEnabled: color });
};

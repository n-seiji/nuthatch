import { homedir } from "node:os";
import type { PickCandidate } from "../domain/candidates.ts";
import {
  buildFrame,
  GUTTER,
  truncateLineToWidth,
  truncateToWidthKeepingTail,
  type StyledLine,
  wrapInBox,
} from "./picker-frame.ts";
import {
  buildDisplayRows,
  computeViewport,
  DEFAULT_TERMINAL_HEIGHT,
  LEGEND_TEXT,
  rawBranchColumnWidth,
  rowBudget,
  type DisplayRow,
} from "./picker-layout.ts";
import type { PickerKeyEvent } from "./picker-key-parser.ts";
import {
  constrainRowColumnWidths,
  footerHintForWidth,
  isNarrowTerminal,
} from "./picker-side-by-side.ts";
import { createPickerStore, type PickerSnapshot } from "./picker-store.ts";
import type { PickerCallbacks, PickerMode, PickerResult } from "./picker-types.ts";
import { buildActionPanelRows, buildConfirmPanelRows, SIDE_PANEL_WIDTH } from "./side-panel.ts";
import { runTerminalSession } from "./terminal-session.ts";

export type {
  ActionOutcome,
  PickerCallbacks,
  PickerCancellation,
  PickerOutcome,
  PickerResult,
} from "./picker-types.ts";

const DEFAULT_TERMINAL_WIDTH = 80;

/**
 * `stream.columns`/`stream.rows` is `undefined` when the stream isn't a
 * TTY at all, but some pty implementations (notably the one this repo's own
 * integration tests drive, before any resize) report a real `0` from
 * `TIOCGWINSZ` instead -- `??`'s fallback never triggers on `0`, so a
 * literal 0 used to flow all the way into truncateLineToWidth as the
 * terminal width and collapse every line down to just an ellipsis. Treat
 * anything not strictly positive as "unknown" too.
 */
const terminalDimension = (value: number | undefined, fallback: number): number =>
  value !== undefined && value > 0 ? value : fallback;

/** Whether SGR color codes should be emitted at all — NO_COLOR (any non-empty value, per the convention) or a non-TTY stderr both disable it; a picker running under `--json`-style piping should never leak escape codes into whatever's consuming stderr. */
const colorEnabled = (stderr: NodeJS.WriteStream): boolean =>
  stderr.isTTY === true && (process.env["NO_COLOR"] ?? "") === "";

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

const candidateRowLine = (
  row: Extract<DisplayRow, { kind: "candidate" }>,
  selected: boolean,
): StyledLine => {
  const marker = selected ? "❯ " : "  ";
  const text = `${marker}${row.statusMarker} ${row.branchLabel}  ${row.kindLabel} ${row.pathLabel}`;
  if (selected) {
    return [{ text, style: "inverse" }];
  }
  return [{ text, style: row.section === "branch" ? "dim" : "plain" }];
};

const displayRowLine = (row: DisplayRow, clampedIndex: number): StyledLine =>
  row.kind === "header"
    ? [{ text: row.label, style: "bold-dim" }]
    : candidateRowLine(row, row.index === clampedIndex);

interface BuildListLinesInput {
  readonly query: string;
  readonly maxWidth: number;
  readonly rows: readonly DisplayRow[];
  readonly clampedIndex: number;
  readonly hiddenAbove: number;
  readonly hiddenBelow: number;
  readonly footerHint: string;
}

const buildListLines = ({
  query,
  maxWidth,
  rows,
  clampedIndex,
  hiddenAbove,
  hiddenBelow,
  footerHint,
}: BuildListLinesInput): StyledLine[] => {
  const lines: StyledLine[] = [queryLine(query, maxWidth)];
  if (rows.length === 0) {
    lines.push([{ text: "No matches.", style: "dim" }]);
  }
  const above = hiddenCountLine(hiddenAbove, "above");
  if (above !== null) {
    lines.push(above);
  }
  for (const row of rows) {
    lines.push(displayRowLine(row, clampedIndex));
  }
  const below = hiddenCountLine(hiddenBelow, "below");
  if (below !== null) {
    lines.push(below);
  }
  lines.push([{ text: `(${LEGEND_TEXT})`, style: "dim" }], [{ text: footerHint, style: "dim" }]);
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
  const { query, filtered, clampedIndex, mode, panelIndex, busy } = snapshot;
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
  }).map((line) => truncateLineToWidth(line, listColumnWidth));

  return buildFrame({ left, right, stacked, colorEnabled: color });
};

/** Ctrl+C, in any mode: raw-mode stdin never generates a real SIGINT for it (see terminal-session.ts's module comment), so it's handled here — before any mode-specific dispatch — rather than relying on picker-keys.ts's per-mode resolvers (only the list-mode one recognizes it). */
const isCtrlC = (event: PickerKeyEvent): boolean => event.key.ctrl && event.input === "c";

/**
 * Runs the picker on stderr (never stdout — stdout is reserved for the
 * final selected path, per the CLI's cd contract) and resolves with the
 * outcome: a selection/completed action, or a cancellation carrying which
 * key caused it (Esc vs. Ctrl+C — see PickerCancellation and cli-pick.ts,
 * which map these to different exit codes).
 */
export const runPicker = (
  candidates: readonly PickCandidate[],
  callbacks: PickerCallbacks,
): Promise<PickerResult> =>
  runTerminalSession<PickerResult>(({ requestRender, finish }) => {
    const store = createPickerStore(
      candidates,
      callbacks,
      (outcome) => finish(outcome),
      (reason) => finish({ type: "cancelled", reason }),
    );
    store.subscribe(requestRender);

    return {
      onKey: (event) => {
        if (isCtrlC(event)) {
          finish({ type: "cancelled", reason: "ctrlC" });
          return;
        }
        store.handleInput(event.input, event.key);
      },
      buildFrame: () =>
        renderPickerFrame({
          snapshot: store.getSnapshot(),
          width: terminalDimension(process.stderr.columns, DEFAULT_TERMINAL_WIDTH),
          height: terminalDimension(process.stderr.rows, DEFAULT_TERMINAL_HEIGHT),
          colorEnabled: colorEnabled(process.stderr),
        }),
    };
  });

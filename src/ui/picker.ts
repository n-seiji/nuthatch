import { homedir } from "node:os";
import type { PickCandidate } from "../domain/candidates.ts";
import { buildFrame, type StyledLine, wrapInBox } from "./picker-frame.ts";
import {
  buildDisplayRows,
  computeViewport,
  isNarrowTerminal,
  LEGEND_TEXT,
  rowBudget,
  type DisplayRow,
} from "./picker-layout.ts";
import type { PickerKeyEvent } from "./picker-key-parser.ts";
import { createPickerStore, type PickerSnapshot } from "./picker-store.ts";
import type { PickerCallbacks, PickerMode, PickerResult } from "./picker-types.ts";
import { buildActionPanelRows, buildConfirmPanelRows, SIDE_PANEL_WIDTH } from "./side-panel.ts";
import { runTerminalSession } from "./terminal-session.ts";
import { DEFAULT_TERMINAL_HEIGHT } from "./picker-viewport.ts";

export type {
  ActionOutcome,
  PickerCallbacks,
  PickerCancellation,
  PickerOutcome,
  PickerResult,
} from "./picker-types.ts";

const DEFAULT_TERMINAL_WIDTH = 80;

const LIST_FOOTER_HINT =
  "Tab/→/Ctrl+L actions · Ctrl+X delete · Ctrl+R switch root · ↑↓/Ctrl+P,N,K,J move · Enter cd · Esc cancel";
const PANEL_FOOTER_HINT =
  "↑↓/Ctrl+P,N,K,J move · Enter run · c/d/r shortcuts · Esc/Tab/←/Ctrl+H close";

/** Whether SGR color codes should be emitted at all — NO_COLOR (any non-empty value, per the convention) or a non-TTY stderr both disable it; a picker running under `--json`-style piping should never leak escape codes into whatever's consuming stderr. */
const colorEnabled = (stderr: NodeJS.WriteStream): boolean =>
  stderr.isTTY === true && (process.env["NO_COLOR"] ?? "") === "";

const queryLine = (query: string): StyledLine => [
  { text: "hop: " },
  { text: query, style: "cyan" },
  { text: query.length === 0 ? " (type to filter)" : "", style: "dim" },
];

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
  readonly rows: readonly DisplayRow[];
  readonly clampedIndex: number;
  readonly hiddenAbove: number;
  readonly hiddenBelow: number;
  readonly footerHint: string;
}

const buildListLines = ({
  query,
  rows,
  clampedIndex,
  hiddenAbove,
  hiddenBelow,
  footerHint,
}: BuildListLinesInput): StyledLine[] => {
  const lines: StyledLine[] = [queryLine(query)];
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
  const budget = rowBudget({ terminalHeight: height, panelStacked: stacked });
  const viewport = computeViewport(filtered.length, clampedIndex, budget);
  const visible = filtered.slice(viewport.start, viewport.end);
  const rows = buildDisplayRows(visible, homedir(), viewport.start);

  const left = buildListLines({
    query,
    rows,
    clampedIndex,
    hiddenAbove: viewport.hiddenAbove,
    hiddenBelow: viewport.hiddenBelow,
    footerHint: right === null ? LIST_FOOTER_HINT : PANEL_FOOTER_HINT,
  });

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
          width: process.stderr.columns ?? DEFAULT_TERMINAL_WIDTH,
          height: process.stderr.rows ?? DEFAULT_TERMINAL_HEIGHT,
          colorEnabled: colorEnabled(process.stderr),
        }),
    };
  });

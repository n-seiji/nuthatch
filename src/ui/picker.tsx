import { homedir } from "node:os";
import { Box, render, Text, useInput } from "ink";
import type { PickCandidate } from "../domain/candidates.ts";
import { runInAltScreenSession } from "./alt-screen-session.ts";
import { usePickerController } from "./picker-controller.ts";
import type { PickerCancelReason } from "./picker-keys.ts";
import {
  buildDisplayRows,
  computeViewport,
  displayRowKey,
  isNarrowTerminal,
  LEGEND_TEXT,
  rowBudget,
  type DisplayRow,
} from "./picker-layout.ts";
import type { PickerCallbacks, PickerMode, PickerResult } from "./picker-types.ts";
import { ActionPanel, ConfirmPanel } from "./side-panel.tsx";
import { useTerminalHeight, useTerminalWidth } from "./use-terminal-width.ts";

export type {
  ActionOutcome,
  PickerCallbacks,
  PickerCancellation,
  PickerOutcome,
  PickerResult,
} from "./picker-types.ts";

const LIST_FOOTER_HINT =
  "Tab/→/Ctrl+L actions · Ctrl+X delete · Ctrl+R switch root · ↑↓/Ctrl+P,N,K,J move · Enter cd · Esc cancel";
const PANEL_FOOTER_HINT =
  "↑↓/Ctrl+P,N,K,J move · Enter run · c/d/r shortcuts · Esc/Tab/←/Ctrl+H close";

interface PickerListProps {
  readonly query: string;
  readonly rows: readonly DisplayRow[];
  readonly clampedIndex: number;
  readonly hiddenAbove: number;
  readonly hiddenBelow: number;
  readonly footerHint: string;
  readonly marginRight: number;
}

/** The "N more" line above/below the window — reused for both directions, singular wording included since it can read either "1 more" or "12 more". */
const HiddenCountLine = ({
  count,
  direction,
}: {
  readonly count: number;
  readonly direction: "above" | "below";
}) =>
  count > 0 ? (
    <Text dimColor>
      {direction === "above" ? "↑ " : "↓ "}
      {count} more {direction === "above" ? "above" : "below"} (keep typing to narrow down)
    </Text>
  ) : null;

const PickerList = ({
  query,
  rows,
  clampedIndex,
  hiddenAbove,
  hiddenBelow,
  footerHint,
  marginRight,
}: PickerListProps) => (
  <Box flexDirection="column" marginRight={marginRight}>
    <Text>
      hop: <Text color="cyan">{query}</Text>
      <Text dimColor>{query.length === 0 ? " (type to filter)" : ""}</Text>
    </Text>
    {rows.length === 0 && <Text dimColor>No matches.</Text>}
    <HiddenCountLine count={hiddenAbove} direction="above" />
    {rows.map((row) => {
      if (row.kind === "header") {
        return (
          <Text key={displayRowKey(row)} bold dimColor>
            {row.label}
          </Text>
        );
      }
      const selected = row.index === clampedIndex;
      return (
        <Text
          key={displayRowKey(row)}
          inverse={selected}
          dimColor={!selected && row.section === "branch"}
        >
          {`${selected ? "❯ " : "  "}${row.statusMarker} ${row.branchLabel}  ${row.kindLabel} ${row.pathLabel}`}
        </Text>
      );
    })}
    <HiddenCountLine count={hiddenBelow} direction="below" />
    <Text dimColor>({LEGEND_TEXT})</Text>
    <Text dimColor>{footerHint}</Text>
  </Box>
);

/** The right-column content for the current mode, or null in plain list mode. */
const renderSidePanel = (mode: PickerMode, panelIndex: number, busy: boolean) => {
  if (mode.kind === "panel") {
    return (
      <ActionPanel
        candidate={mode.candidate}
        panelIndex={panelIndex}
        error={mode.error}
        busy={busy}
      />
    );
  }
  if (mode.kind === "confirm") {
    return <ConfirmPanel candidate={mode.candidate} action={mode.action} />;
  }
  return null;
};

interface PickerProps {
  readonly candidates: readonly PickCandidate[];
  readonly callbacks: PickerCallbacks;
  readonly onExit: (outcome: Exclude<PickerResult, { type: "cancelled" }>) => void;
  readonly onCancel: (reason: PickerCancelReason) => void;
}

const Picker = ({ candidates, callbacks, onExit, onCancel }: PickerProps) => {
  const { query, filtered, clampedIndex, mode, panelIndex, busy, handleInput } =
    usePickerController(candidates, callbacks, onExit, onCancel);

  useInput(handleInput);

  const width = useTerminalWidth(process.stderr);
  const height = useTerminalHeight(process.stderr);
  const narrow = isNarrowTerminal(width);

  const sidePanel = renderSidePanel(mode, panelIndex, busy);
  // The panel only stacks below the list (consuming vertical rows the list
  // Would otherwise use) in narrow terminals; side-by-side it costs no rows.
  const panelStacked = sidePanel !== null && narrow;
  const budget = rowBudget({ terminalHeight: height, panelStacked });
  const viewport = computeViewport(filtered.length, clampedIndex, budget);
  const visible = filtered.slice(viewport.start, viewport.end);
  const rows = buildDisplayRows(visible, homedir(), viewport.start);

  const list = (
    <PickerList
      query={query}
      rows={rows}
      clampedIndex={clampedIndex}
      hiddenAbove={viewport.hiddenAbove}
      hiddenBelow={viewport.hiddenBelow}
      footerHint={sidePanel === null ? LIST_FOOTER_HINT : PANEL_FOOTER_HINT}
      marginRight={sidePanel === null || narrow ? 0 : 1}
    />
  );

  if (sidePanel === null) {
    return list;
  }

  // Narrow terminals (see isNarrowTerminal) can't fit the panel beside the
  // List, so it falls back to stacking below — the picker's original layout.
  if (narrow) {
    return (
      <Box flexDirection="column">
        {list}
        {sidePanel}
      </Box>
    );
  }

  return (
    <Box flexDirection="row">
      {list}
      {sidePanel}
    </Box>
  );
};

/**
 * Renders the picker to stderr (never stdout — stdout is reserved for the
 * final selected path, per the CLI's cd contract) and resolves with the
 * outcome: a selection/completed action, or a cancellation carrying which
 * key caused it (Esc vs. Ctrl+C — see PickerCancellation and cli-pick.ts,
 * which map these to different exit codes). Alt-screen/SIGINT/exit safety
 * wiring lives in alt-screen-session.ts — see its module comment.
 */
export const runPicker = (
  candidates: readonly PickCandidate[],
  callbacks: PickerCallbacks,
): Promise<PickerResult> =>
  runInAltScreenSession<PickerResult>((finish) =>
    render(
      <Picker
        candidates={candidates}
        callbacks={callbacks}
        onExit={(outcome) => finish(outcome)}
        onCancel={(reason) => finish({ type: "cancelled", reason })}
      />,
      { stdout: process.stderr },
    ),
  );

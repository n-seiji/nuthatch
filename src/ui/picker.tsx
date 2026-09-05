import { homedir } from "node:os";
import { Box, render, Text, useInput } from "ink";
import type { PickCandidate } from "../domain/candidates.ts";
import { runInAltScreenSession } from "./alt-screen-session.ts";
import { usePickerController } from "./picker-controller.ts";
import type { PickerCancelReason } from "./picker-keys.ts";
import {
  buildDisplayRows,
  displayRowKey,
  isNarrowTerminal,
  LEGEND_TEXT,
  type DisplayRow,
} from "./picker-layout.ts";
import type { PickerCallbacks, PickerMode, PickerResult } from "./picker-types.ts";
import { ActionPanel, ConfirmDeletePanel } from "./side-panel.tsx";
import { useTerminalWidth } from "./use-terminal-width.ts";

export type {
  ActionOutcome,
  PickerCallbacks,
  PickerCancellation,
  PickerOutcome,
  PickerResult,
} from "./picker-types.ts";

const MAX_VISIBLE_ROWS = 15;

const LIST_FOOTER_HINT =
  "Tab/→/Ctrl+L actions · Ctrl+X delete · Ctrl+R switch root · ↑↓/Ctrl+P,N,K,J move · Enter cd · Esc cancel";
const PANEL_FOOTER_HINT =
  "↑↓/Ctrl+P,N,K,J move · Enter run · c/d/r shortcuts · Esc/Tab/←/Ctrl+H close";

interface PickerListProps {
  readonly query: string;
  readonly rows: readonly DisplayRow[];
  readonly clampedIndex: number;
  readonly hiddenCount: number;
  readonly footerHint: string;
  readonly marginRight: number;
}

const PickerList = ({
  query,
  rows,
  clampedIndex,
  hiddenCount,
  footerHint,
  marginRight,
}: PickerListProps) => (
  <Box flexDirection="column" marginRight={marginRight}>
    <Text>
      hop: <Text color="cyan">{query}</Text>
      <Text dimColor>{query.length === 0 ? " (type to filter)" : ""}</Text>
    </Text>
    {rows.length === 0 && <Text dimColor>No matches.</Text>}
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
    {hiddenCount > 0 && (
      <Text dimColor>... and {hiddenCount} more (keep typing to narrow down)</Text>
    )}
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
  if (mode.kind === "confirmDelete") {
    return <ConfirmDeletePanel candidate={mode.candidate} />;
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
  const narrow = isNarrowTerminal(width);

  const visible = filtered.slice(0, MAX_VISIBLE_ROWS);
  const hiddenCount = filtered.length - visible.length;
  const rows = buildDisplayRows(visible, homedir());
  const sidePanel = renderSidePanel(mode, panelIndex, busy);

  const list = (
    <PickerList
      query={query}
      rows={rows}
      clampedIndex={clampedIndex}
      hiddenCount={hiddenCount}
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

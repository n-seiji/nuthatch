import { homedir } from "node:os";
import { Box, render, Text, useInput } from "ink";
import { candidateBranchName, type PickCandidate } from "../domain/candidates.ts";
import { ActionPanel } from "./action-panel.tsx";
import { usePickerController } from "./picker-controller.ts";
import { buildDisplayRows, displayRowKey, LEGEND_TEXT } from "./picker-layout.ts";
import type { PickerCallbacks, PickerOutcome } from "./picker-types.ts";

export type { ActionOutcome, PickerCallbacks, PickerOutcome } from "./picker-types.ts";

const MAX_VISIBLE_ROWS = 15;

interface PickerProps {
  readonly candidates: readonly PickCandidate[];
  readonly callbacks: PickerCallbacks;
  readonly onExit: (outcome: PickerOutcome) => void;
  readonly onCancel: () => void;
}

const Picker = ({ candidates, callbacks, onExit, onCancel }: PickerProps) => {
  const { query, filtered, clampedIndex, mode, panelIndex, busy, handleInput } =
    usePickerController(candidates, callbacks, onExit, onCancel);

  useInput(handleInput);

  const visible = filtered.slice(0, MAX_VISIBLE_ROWS);
  const hiddenCount = filtered.length - visible.length;
  const rows = buildDisplayRows(visible, homedir());

  return (
    <Box flexDirection="column">
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
      <Text dimColor>
        Ctrl+K actions · Ctrl+X delete · Ctrl+R switch root · Enter cd · Esc cancel
      </Text>
      {mode.kind === "panel" && (
        <ActionPanel
          candidate={mode.candidate}
          panelIndex={panelIndex}
          error={mode.error}
          busy={busy}
        />
      )}
      {mode.kind === "confirmDelete" && (
        <Box flexDirection="column" borderStyle="round" paddingX={1}>
          <Text>
            Delete worktree for <Text color="cyan">{candidateBranchName(mode.candidate)}</Text>?
            (y/N)
          </Text>
        </Box>
      )}
    </Box>
  );
};

/**
 * Renders the picker to stderr (never stdout — stdout is reserved for the
 * final selected path, per the CLI's cd contract) and resolves with the
 * chosen outcome, or null on ESC/Ctrl-C.
 */
export const runPicker = (
  candidates: readonly PickCandidate[],
  callbacks: PickerCallbacks,
): Promise<PickerOutcome | null> =>
  new Promise((resolve) => {
    const instance = render(
      <Picker
        candidates={candidates}
        callbacks={callbacks}
        onExit={(outcome) => {
          instance.unmount();
          resolve(outcome);
        }}
        onCancel={() => {
          instance.unmount();
          resolve(null);
        }}
      />,
      { stdout: process.stderr },
    );
  });

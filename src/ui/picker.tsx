import { Box, render, Text, useInput } from "ink";
import {
  candidateBranchLabel,
  candidateBranchName,
  type PickCandidate,
} from "../domain/candidates.ts";
import { ActionPanel } from "./action-panel.tsx";
import { usePickerController } from "./picker-controller.ts";
import type { PickerCallbacks, PickerOutcome } from "./picker-types.ts";

export type { ActionOutcome, PickerCallbacks, PickerOutcome } from "./picker-types.ts";

const MAX_VISIBLE_ROWS = 15;

const kindTag = (candidate: PickCandidate): string =>
  candidate.kind === "worktree" ? candidate.worktree.kind : `new (${candidate.source})`;

const dirtyTag = (candidate: PickCandidate): string => {
  if (candidate.kind !== "worktree") {
    return "";
  }
  if (candidate.dirty === null) {
    return "";
  }
  return candidate.dirty ? " dirty" : "";
};

const pathTag = (candidate: PickCandidate): string =>
  candidate.kind === "worktree" ? candidate.worktree.path : "(not created yet)";

export const candidateRowKey = (candidate: PickCandidate, index: number): string =>
  `${index}:${candidateBranchLabel(candidate)}`;

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

  return (
    <Box flexDirection="column">
      <Text>
        hop: <Text color="cyan">{query}</Text>
        <Text dimColor>{query.length === 0 ? " (type to filter)" : ""}</Text>
      </Text>
      {visible.length === 0 && <Text dimColor>No matches.</Text>}
      {visible.map((candidate, rowIndex) => {
        const selected = rowIndex === clampedIndex;
        const label = candidateBranchLabel(candidate);
        return (
          <Text key={candidateRowKey(candidate, rowIndex)} inverse={selected}>
            {`${selected ? "> " : "  "}[${kindTag(candidate)}${dirtyTag(candidate)}] ${label} ${pathTag(candidate)}`}
          </Text>
        );
      })}
      {filtered.length > MAX_VISIBLE_ROWS && (
        <Text dimColor>
          ... and {filtered.length - MAX_VISIBLE_ROWS} more (keep typing to narrow down)
        </Text>
      )}
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

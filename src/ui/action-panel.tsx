import { Box, Text } from "ink";
import { type PickerActionKind, availableActions } from "../domain/actions.ts";
import { candidateBranchLabel, type PickCandidate } from "../domain/candidates.ts";

export const ACTION_LABELS: Record<PickerActionKind, string> = {
  cd: "cd into this worktree",
  delete: "delete worktree",
  switchRoot: "switch root here",
};

export const ACTION_LETTERS: Record<PickerActionKind, string> = {
  cd: "c",
  delete: "d",
  switchRoot: "r",
};

interface ActionPanelProps {
  readonly candidate: PickCandidate;
  readonly panelIndex: number;
  readonly error: string | null;
  readonly busy: boolean;
}

export const ActionPanel = ({ candidate, panelIndex, error, busy }: ActionPanelProps) => {
  const actions = availableActions(candidate);
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text>
        Actions for <Text color="cyan">{candidateBranchLabel(candidate)}</Text>
      </Text>
      {actions.map((action, actionIndex) => (
        <Text key={action} inverse={actionIndex === panelIndex}>
          {`${actionIndex === panelIndex ? "> " : "  "}[${ACTION_LETTERS[action]}] ${ACTION_LABELS[action]}`}
        </Text>
      ))}
      {busy && <Text dimColor>Working…</Text>}
      {error !== null && <Text color="red">{error}</Text>}
    </Box>
  );
};

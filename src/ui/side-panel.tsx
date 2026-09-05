import { Box, Text } from "ink";
import { type PickerActionKind, availableActions } from "../domain/actions.ts";
import {
  candidateBranchLabel,
  candidateBranchName,
  type PickCandidate,
} from "../domain/candidates.ts";

/**
 * The picker's side column: the action panel and the y/N delete-confirmation
 * panel. Kept in one file (rather than one component per file, as before)
 * so picker.tsx's import count stays under the lint limit — these two only
 * ever render in the same slot anyway (see picker.tsx's `sidePanel`).
 */

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

/** Fixed width for the side panel (both the action panel and the confirm-delete panel), so the column layout doesn't jump around as content changes. */
export const SIDE_PANEL_WIDTH = 34;

interface ActionPanelProps {
  readonly candidate: PickCandidate;
  readonly panelIndex: number;
  readonly error: string | null;
  readonly busy: boolean;
}

export const ActionPanel = ({ candidate, panelIndex, error, busy }: ActionPanelProps) => {
  const actions = availableActions(candidate);
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} width={SIDE_PANEL_WIDTH}>
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

interface ConfirmDeletePanelProps {
  readonly candidate: PickCandidate;
}

/** The y/N delete-confirmation panel (Ctrl+X shortcut), rendered in the same side-column slot the action panel uses. */
export const ConfirmDeletePanel = ({ candidate }: ConfirmDeletePanelProps) => (
  <Box flexDirection="column" borderStyle="round" paddingX={1} width={SIDE_PANEL_WIDTH}>
    <Text>
      Delete worktree for <Text color="cyan">{candidateBranchName(candidate)}</Text>?
    </Text>
    <Text dimColor>(y/N)</Text>
  </Box>
);

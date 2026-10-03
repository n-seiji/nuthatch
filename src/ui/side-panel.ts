import { type PickerActionKind, availableActions } from "../domain/actions.ts";
import {
  candidateBranchLabel,
  candidateBranchName,
  type PickCandidate,
} from "../domain/candidates.ts";
import type { StyledLine } from "./picker-frame.ts";

/**
 * The picker's side column: row builders for the action panel and the y/N
 * delete/switchRoot confirmation panel. Pure functions returning StyledLine
 * rows (see picker-frame.ts) — picker-render.ts wraps the result in a
 * border via picker-frame.ts's wrapInBox.
 */

const ACTION_LABELS: Record<PickerActionKind, string> = {
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

export interface ActionPanelRowsInput {
  readonly candidate: PickCandidate;
  readonly panelIndex: number;
  readonly error: string | null;
  readonly busy: boolean;
}

export const buildActionPanelRows = ({
  candidate,
  panelIndex,
  error,
  busy,
}: ActionPanelRowsInput): StyledLine[] => {
  const actions = availableActions(candidate);
  const rows: StyledLine[] = [
    [{ text: "Actions for " }, { text: candidateBranchLabel(candidate), style: "cyan" }],
    ...actions.map((action, actionIndex): StyledLine => {
      const marker = actionIndex === panelIndex ? "> " : "  ";
      const text = `${marker}[${ACTION_LETTERS[action]}] ${ACTION_LABELS[action]}`;
      return [{ text, style: actionIndex === panelIndex ? "inverse" : "plain" }];
    }),
  ];
  if (busy) {
    rows.push([{ text: "Working…", style: "dim" }]);
  }
  if (error !== null) {
    rows.push([{ text: error, style: "red" }]);
  }
  return rows;
};

export interface ConfirmPanelRowsInput {
  readonly candidate: PickCandidate;
  readonly action: Exclude<PickerActionKind, "cd">;
}

const CONFIRM_QUESTIONS: Record<Exclude<PickerActionKind, "cd">, string> = {
  delete: "Delete worktree for",
  switchRoot: "Switch root here for",
};

/**
 * Row builder for the y/N confirmation panel (delete via Ctrl+X or the
 * panel, or switch root via Ctrl+R/panel) — rendered in the same side-column
 * slot the action panel uses. Switching root can detach the candidate's
 * HEAD, and deleting a prunable worktree is not dirty-checked (see
 * requiresDeleteConfirmation), so the panel makes each explicit.
 */
export const buildConfirmPanelRows = ({
  candidate,
  action,
}: ConfirmPanelRowsInput): StyledLine[] => {
  const rows: StyledLine[] = [
    [
      { text: `${CONFIRM_QUESTIONS[action]} ` },
      { text: candidateBranchName(candidate) ?? "", style: "cyan" },
      { text: "?" },
    ],
  ];
  if (action === "switchRoot") {
    rows.push([{ text: "This will put it into detached HEAD.", style: "dim" }]);
  }
  if (action === "delete" && candidate.kind === "worktree" && candidate.worktree.prunable) {
    // Two rows, each within the box's inner width, so the note never wraps mid-word.
    rows.push(
      [{ text: "Prunable, not dirty-checked:", style: "dim" }],
      [{ text: "removes just its registration.", style: "dim" }],
    );
  }
  rows.push([{ text: "(y/N)", style: "dim" }]);
  return rows;
};

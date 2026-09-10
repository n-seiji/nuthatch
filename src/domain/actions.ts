import type { PickCandidate } from "./schema.ts";

/**
 * Actions the picker's action panel can offer for a candidate. `cd` is
 * always available; `delete` and `switchRoot` depend on the candidate's
 * kind (see availableActions).
 */
export const PICKER_ACTIONS = ["cd", "delete", "switchRoot"] as const;
export type PickerActionKind = (typeof PICKER_ACTIONS)[number];

/**
 * Which panel actions apply to a given picker candidate. Pure so it can be
 * unit tested without ink or git:
 *
 * - `cd`: every candidate.
 * - `delete`: any already-created worktree except root (`kind: "managed"` or
 *   `"external"`). External worktrees still offer delete — hop can now
 *   manage worktrees it didn't create — but the picker always gates deleting
 *   one behind an explicit y/N confirmation (see requiresDeleteConfirmation
 *   below), since it may be another agent's in-use working copy. Root never
 *   offers delete — it isn't a worktree to remove.
 * - `switchRoot`: every candidate except the root worktree itself (switching
 *   root "here" is meaningless when "here" already is root).
 * - Detached-HEAD worktrees (no branch name) only offer `cd` — `rm`/`root`
 *   both operate by branch name.
 */
export const availableActions = (candidate: PickCandidate): readonly PickerActionKind[] => {
  const actions: PickerActionKind[] = ["cd"];

  if (candidate.kind !== "worktree") {
    actions.push("switchRoot");
    return actions;
  }

  if (candidate.worktree.branch === null) {
    return actions;
  }

  if (candidate.worktree.kind === "managed" || candidate.worktree.kind === "external") {
    actions.push("delete");
  }
  if (candidate.worktree.kind !== "root") {
    actions.push("switchRoot");
  }

  return actions;
};

/**
 * Whether deleting this candidate must go through an explicit y/N
 * confirmation regardless of entry point (Ctrl+X shortcut or the action
 * panel's "delete" entry). Managed worktrees keep the picker's existing
 * behavior (Ctrl+X confirms, the panel entry does not); external worktrees
 * always require it, since they may be another agent's in-use working copy.
 */
export const requiresDeleteConfirmation = (candidate: PickCandidate): boolean =>
  candidate.kind === "worktree" && candidate.worktree.kind === "external";

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
 * - `delete`: only an already-created worktree that nuthatch manages
 *   (`kind: "managed"`). Root and external worktrees never offer delete —
 *   root because it isn't a worktree to remove, external because mutation
 *   must not default onto an agent's worktree (docs/design.md's "worktree
 *   の 3 分類").
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

  if (candidate.worktree.kind === "managed") {
    actions.push("delete");
  }
  if (candidate.worktree.kind !== "root") {
    actions.push("switchRoot");
  }

  return actions;
};

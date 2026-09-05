import type { Worktree } from "./model.ts";
import type { PickCandidate } from "./schema.ts";

export type { PickCandidate } from "./schema.ts";

/**
 * Builds the full picker candidate list: every existing worktree, plus every
 * local/remote branch that doesn't already have one. Local branches take
 * priority over remote branches with the same name (a branch that exists
 * both locally and on a remote is listed once, as local).
 */
export const buildPickCandidates = (
  worktrees: readonly Worktree[],
  dirtyByPath: ReadonlyMap<string, boolean | null>,
  localBranches: readonly string[],
  remoteBranches: readonly string[],
): PickCandidate[] => {
  const existingBranches = new Set(
    worktrees.map((worktree) => worktree.branch).filter((branch) => branch !== null),
  );

  const worktreeCandidates: PickCandidate[] = worktrees.map((worktree) => ({
    kind: "worktree",
    worktree,
    dirty: dirtyByPath.get(worktree.path) ?? null,
  }));

  const localOnly = localBranches.filter((branch) => !existingBranches.has(branch));
  const localSet = new Set(localBranches);
  const remoteOnly = remoteBranches.filter(
    (branch) => !existingBranches.has(branch) && !localSet.has(branch),
  );

  return [
    ...worktreeCandidates,
    ...localOnly.map((branch): PickCandidate => ({
      kind: "creatable",
      branch,
      source: "local",
    })),
    ...remoteOnly.map((branch): PickCandidate => ({
      kind: "creatable",
      branch,
      source: "remote",
    })),
  ];
};

/** Stable, human-searchable key for a candidate row (used for list keys and filtering). */
export const candidateBranchLabel = (candidate: PickCandidate): string =>
  candidate.kind === "worktree" ? (candidate.worktree.branch ?? "(detached)") : candidate.branch;

/**
 * The branch name to pass to `rm`/`root` for a candidate. Only meaningful
 * for candidates where `availableActions` offers `delete`/`switchRoot`
 * (i.e. never called on a detached-HEAD worktree candidate); returns `null`
 * there rather than the "(detached)" placeholder `candidateBranchLabel` uses
 * for display.
 */
export const candidateBranchName = (candidate: PickCandidate): string | null =>
  candidate.kind === "worktree" ? candidate.worktree.branch : candidate.branch;

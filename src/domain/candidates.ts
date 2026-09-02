import type { Worktree } from "./model.ts";

/**
 * A single row for the interactive picker: either an existing worktree
 * (any of the 3 classifications), or a branch that has no worktree yet and
 * would need to be created (jump's --create path) if selected.
 */
export type PickCandidate =
  | {
      readonly kind: "worktree";
      readonly worktree: Worktree;
      /** Null when dirtiness couldn't be determined (e.g. a bare worktree). */
      readonly dirty: boolean | null;
    }
  | {
      readonly kind: "creatable";
      readonly branch: string;
      readonly source: "local" | "remote";
    };

/**
 * Builds the full picker candidate list: every existing worktree, plus every
 * local/remote branch that doesn't already have one. Local branches take
 * priority over remote branches with the same name (a branch that exists
 * both locally and on a remote is listed once, as local).
 *
 * `dirtyByPath` is injected (keyed by worktree path) so this stays a pure
 * function — actually checking dirtiness requires a git call, which is the
 * caller's (infra-backed) responsibility.
 */
export const buildPickCandidates = (
  worktrees: readonly Worktree[],
  dirtyByPath: ReadonlyMap<string, boolean>,
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

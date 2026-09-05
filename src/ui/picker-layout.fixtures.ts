import type { PickCandidate } from "../domain/candidates.ts";
import type { Worktree } from "../domain/model.ts";

/**
 * Shared candidate fixtures for picker-layout's test files (unit tests split
 * across picker-layout.test.ts and picker-layout-sort.test.ts to stay under
 * the max-lines lint limit). Test-only — never imported from src/ outside
 * tests.
 */
export const worktree = (overrides: Partial<Worktree> = {}): Worktree => ({
  path: "/repo",
  head: "abc",
  branch: "main",
  detached: false,
  bare: false,
  locked: false,
  lockReason: null,
  prunable: false,
  prunableReason: null,
  kind: "root",
  ...overrides,
});

export const worktreeCandidate = (
  overrides: Partial<Worktree> = {},
  dirty: boolean | null = null,
): PickCandidate => ({
  kind: "worktree",
  worktree: worktree(overrides),
  dirty,
});

export const creatableCandidate = (branch: string, source: "local" | "remote"): PickCandidate => ({
  kind: "creatable",
  branch,
  source,
});

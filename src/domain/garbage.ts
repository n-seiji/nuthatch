export type GarbageReason = "prunable" | "merged" | "gone";

/**
 * Facts about a single managed worktree, gathered by infra/commands and
 * passed in as plain values so this stays a pure decision function.
 * Tri-state fields use `"unknown"` when git couldn't determine the answer
 * (e.g. origin/HEAD missing) — unknown must never be treated as true.
 */
export interface GarbageInput {
  readonly prunable: boolean;
  /** No uncommitted changes, staged or unstaged, and no untracked files. */
  readonly clean: boolean;
  readonly mergedIntoDefault: boolean | "unknown";
  readonly upstreamGone: boolean;
  /** True if every commit reachable from the branch is also reachable from the default branch. */
  readonly allCommitsReachableFromDefault: boolean | "unknown";
}

/**
 * Decides whether a worktree is safe to auto-clean, and why.
 * Returns null when it is not a candidate — including when the underlying
 * facts are unknown, per the "lose nothing" safety rule in docs/design.md.
 */
export const classifyGarbage = (input: GarbageInput): GarbageReason | null => {
  if (input.prunable) return "prunable";
  if (!input.clean) return null;
  if (input.mergedIntoDefault === true) return "merged";
  if (input.upstreamGone && input.allCommitsReachableFromDefault === true) return "gone";
  return null;
};

import { isWithin } from "./classify.ts";
import type { Worktree } from "./model.ts";

export type StatusTarget =
  | { readonly kind: "found"; readonly worktree: Worktree }
  | { readonly kind: "notFound"; readonly message: string }
  | { readonly kind: "ambiguous"; readonly message: string };

/**
 * Which worktree `hop status` reports on: the one holding `branch`, or —
 * without a branch — the one containing `cwdPath` (realpath'd). For a cwd,
 * the innermost worktree wins, so a worktree nested inside another (e.g.
 * Claude Code's `.claude/worktrees/x` under the root clone) is reported as
 * itself, not as its parent. A branch held by several worktrees is ambiguous
 * rather than a guess, the same rule `hop rm` follows.
 */
export const resolveStatusTarget = (
  worktrees: readonly Worktree[],
  target: { readonly branch: string } | { readonly cwdPath: string },
): StatusTarget => {
  if ("branch" in target) {
    const matches = worktrees.filter((wt) => wt.branch === target.branch);
    const [only] = matches;
    if (only === undefined) {
      return { kind: "notFound", message: `No worktree found for branch "${target.branch}".` };
    }
    if (matches.length > 1) {
      return {
        kind: "ambiguous",
        message: `Branch "${target.branch}" is checked out at ${matches.length} worktrees (${matches.map((wt) => wt.path).join(", ")}). Pass the path as the working directory instead of the branch.`,
      };
    }
    return { kind: "found", worktree: only };
  }

  const containing = worktrees.filter(
    (wt) => !wt.prunable && (wt.path === target.cwdPath || isWithin(wt.path, target.cwdPath)),
  );
  // Every candidate contains cwdPath, so the longest path is the innermost.
  const [innermost] = containing.toSorted((a, b) => b.path.length - a.path.length);
  if (innermost === undefined) {
    return {
      kind: "notFound",
      message: `${target.cwdPath} is not inside any worktree of this repository. Pass a branch name.`,
    };
  }
  return { kind: "found", worktree: innermost };
};

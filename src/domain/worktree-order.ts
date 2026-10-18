import type { WorktreeKind } from "./model.ts";

const WORKTREE_KIND_ORDER: Record<WorktreeKind, number> = {
  root: 0,
  managed: 1,
  external: 2,
};

interface Orderable {
  readonly kind: WorktreeKind;
  readonly branch: string | null;
}

/**
 * The order worktrees are shown in, shared by the picker and `hop ls`: root,
 * then managed, then external; branch name ascending within a kind, and
 * detached HEAD (no branch to sort by) last. Two detached worktrees of the
 * same kind tie (0), so a caller can break the tie its own way.
 */
export const compareWorktrees = (a: Orderable, b: Orderable): number => {
  const kindDiff = WORKTREE_KIND_ORDER[a.kind] - WORKTREE_KIND_ORDER[b.kind];
  if (kindDiff !== 0) {
    return kindDiff;
  }
  if (a.branch === null || b.branch === null) {
    return Number(a.branch === null) - Number(b.branch === null);
  }
  return a.branch.localeCompare(b.branch);
};

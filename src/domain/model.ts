/** Classification of a worktree relative to nuthatch's management scope. */
export type WorktreeKind = "root" | "managed" | "external";

/** A single worktree as reported by `git worktree list`, plus nuthatch's classification. */
export interface Worktree {
  readonly path: string;
  readonly head: string | null;
  readonly branch: string | null;
  readonly detached: boolean;
  readonly bare: boolean;
  readonly locked: boolean;
  readonly lockReason: string | null;
  readonly prunable: boolean;
  readonly prunableReason: string | null;
  readonly kind: WorktreeKind;
}

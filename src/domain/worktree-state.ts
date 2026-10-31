import type { Worktree } from "./schema.ts";

/** A state word plus the color it is shown in (`hop ls` and the picker both paint it). */
export interface WorktreeState {
  readonly text: string;
  readonly tone: "green" | "yellow" | "red" | "dim";
}

/**
 * One state per worktree, most important first: a row that can't be acted on
 * says why before "changes" does. `dirty` is null when there was no working
 * tree to inspect (bare, prunable, or its directory is gone); a non-bare
 * worktree in that situation has nothing on disk, so it reads as missing.
 */
export const worktreeState = (worktree: Worktree, dirty: boolean | null): WorktreeState => {
  if (worktree.prunable) {
    return { text: "✗ missing", tone: "red" };
  }
  if (worktree.locked) {
    return { text: "⊘ locked", tone: "red" };
  }
  if (worktree.bare) {
    return { text: "- bare", tone: "dim" };
  }
  if (dirty === null) {
    return { text: "✗ missing", tone: "red" };
  }
  return dirty ? { text: "● changes", tone: "yellow" } : { text: "✓ clean", tone: "green" };
};

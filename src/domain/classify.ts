import { relative } from "node:path";
import type { WorktreeKind } from "./model.ts";

/**
 * Returns true if `child` is inside `parent`, respecting path boundaries
 * (never a naive string-prefix comparison, so `/a/foo` is not "inside" `/a/f`).
 * Both paths must already be resolved (e.g. via realpath) by the caller.
 */
const isWithin = (parent: string, child: string): boolean => {
  if (parent === child) return false;
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..");
};

/**
 * Classifies a worktree path relative to the repo's root clone path and its
 * managed worktree root (`_worktree/<repo>`). All inputs must be realpath'd.
 */
export const classifyWorktreePath = (
  path: string,
  rootPath: string,
  managedRoot: string,
): WorktreeKind => {
  if (path === rootPath) return "root";
  if (path === managedRoot || isWithin(managedRoot, path)) return "managed";
  return "external";
};

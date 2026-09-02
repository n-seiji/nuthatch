import type { WorktreeKind } from "./model.ts";

/**
 * Returns true if `child` is inside `parent`, respecting path boundaries
 * (never a naive string-prefix comparison, so `/a/foo` is not "inside" `/a/f`).
 * Both paths must already be resolved (e.g. via realpath) by the caller, and
 * use `/` as the path separator (this project targets macOS/Linux only).
 *
 * Implemented as pure string comparison rather than `node:path`'s `relative`
 * so this stays free of Node built-ins, per domain/'s zero-external-dependency rule.
 */
const isWithin = (parent: string, child: string): boolean => {
  if (parent === child) {
    return false;
  }
  const parentWithSlash = parent.endsWith("/") ? parent : `${parent}/`;
  return child.startsWith(parentWithSlash);
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
  if (path === rootPath) {
    return "root";
  }
  if (path === managedRoot || isWithin(managedRoot, path)) {
    return "managed";
  }
  return "external";
};

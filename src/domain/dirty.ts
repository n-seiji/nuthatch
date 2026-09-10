/**
 * Filters `git status --porcelain --untracked-files=all` (v1, non `-z`)
 * lines, dropping any entry whose path is the same as, or nested inside,
 * another worktree's path. A worktree registered elsewhere (e.g. Claude
 * Code's EnterWorktree creating one at `<root>/.claude/worktrees/x`)
 * otherwise pollutes `git status` for whatever worktree contains it, making
 * that containing worktree look dirty even when it has no changes of its
 * own.
 *
 * `targetPath` and every path in `otherWorktreePaths` must already be
 * resolved (e.g. via realpath) by the caller, and use `/` as the path
 * separator (this project targets macOS/Linux only). Containment is decided
 * with prefix-plus-separator logic, never a naive string-prefix comparison
 * (`isSameOrNested` below), consistent with classify.ts's `isWithin`.
 */
export const filterOutNestedWorktreeStatus = (
  statusLines: readonly string[],
  targetPath: string,
  otherWorktreePaths: readonly string[],
): string[] => {
  const target = stripTrailingSlash(targetPath);
  const others = otherWorktreePaths
    .map((path) => stripTrailingSlash(path))
    .filter((path) => path !== target);

  if (others.length === 0) {
    return [...statusLines];
  }

  return statusLines.filter((line) => {
    const relativePath = extractPath(line);
    if (relativePath === null) {
      return true;
    }
    const absolutePath = stripTrailingSlash(`${target}/${relativePath}`);
    return !others.some((other) => isSameOrNested(absolutePath, other));
  });
};

/**
 * True if a worktree at `path` is dirty according to `statusOutput`, after
 * excluding any status lines that belong to another registered worktree
 * nested inside it.
 */
export const isDirtyFromStatus = (
  statusOutput: string,
  targetPath: string,
  otherWorktreePaths: readonly string[],
): boolean => {
  const lines = statusOutput.split("\n").filter((line) => line.length > 0);
  return filterOutNestedWorktreeStatus(lines, targetPath, otherWorktreePaths).length > 0;
};

const stripTrailingSlash = (path: string): string =>
  path.endsWith("/") ? path.slice(0, -1) : path;

const isSameOrNested = (childPath: string, otherPath: string): boolean =>
  childPath === otherPath || childPath.startsWith(`${otherPath}/`);

/**
 * Extracts the path from one `git status --porcelain` (v1, non `-z`) line.
 * Format is `XY PATH` or, for renames, `XY OLD -> NEW` (the destination is
 * what matters for containment). Quoted paths (git quotes ones containing
 * special/non-ASCII bytes under `core.quotePath`) are unquoted verbatim.
 */
const STATUS_CODE_WIDTH = 3;
const RENAME_ARROW = " -> ";

const extractPath = (line: string): string | null => {
  if (line.length <= STATUS_CODE_WIDTH) {
    return null;
  }
  const rawPath = line.slice(STATUS_CODE_WIDTH);
  const arrowIndex = rawPath.indexOf(RENAME_ARROW);
  const path = arrowIndex === -1 ? rawPath : rawPath.slice(arrowIndex + RENAME_ARROW.length);
  return unquote(path);
};

const unquote = (path: string): string =>
  path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path;

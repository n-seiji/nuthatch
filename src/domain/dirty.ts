/**
 * Filters relative paths parsed from `git status --porcelain -z
 * --untracked-files=all` (see parseStatusPaths below), dropping any path
 * that is the same as, or nested inside, another worktree's path. A
 * worktree registered elsewhere (e.g. Claude Code's EnterWorktree creating
 * one at `<root>/.claude/worktrees/x`) otherwise pollutes `git status` for
 * whatever worktree contains it, making that containing worktree look dirty
 * even when it has no changes of its own.
 *
 * `targetPath` and every path in `otherWorktreePaths` must already be
 * resolved (e.g. via realpath) by the caller, and use `/` as the path
 * separator (this project targets macOS/Linux only). Containment is decided
 * with prefix-plus-separator logic, never a naive string-prefix comparison
 * (`isSameOrNested` below), consistent with classify.ts's `isWithin`.
 */
export const filterOutNestedWorktreePaths = (
  relativePaths: readonly string[],
  targetPath: string,
  otherWorktreePaths: readonly string[],
): string[] => {
  const target = stripTrailingSlash(targetPath);
  const others = otherWorktreePaths
    .map((path) => stripTrailingSlash(path))
    .filter((path) => path !== target);

  if (others.length === 0) {
    return [...relativePaths];
  }

  return relativePaths.filter((relativePath) => {
    const absolutePath = stripTrailingSlash(`${target}/${relativePath}`);
    return !others.some((other) => isSameOrNested(absolutePath, other));
  });
};

/**
 * True if a worktree at `path` is dirty according to `statusOutput`, after
 * excluding any status entries that belong to another registered worktree
 * nested inside it.
 */
export const isDirtyFromStatus = (
  statusOutput: string,
  targetPath: string,
  otherWorktreePaths: readonly string[],
): boolean => {
  const paths = parseStatusPaths(statusOutput);
  return filterOutNestedWorktreePaths(paths, targetPath, otherWorktreePaths).length > 0;
};

const stripTrailingSlash = (path: string): string =>
  path.endsWith("/") ? path.slice(0, -1) : path;

const isSameOrNested = (childPath: string, otherPath: string): boolean =>
  childPath === otherPath || childPath.startsWith(`${otherPath}/`);

/**
 * Parses the relative destination paths out of `git status --porcelain -z
 * --untracked-files=all` output.
 *
 * `-z` is load-bearing, not cosmetic: without it, git's default
 * `core.quotePath=true` C-style-quotes any path with non-ASCII or special
 * bytes (e.g. `"\346\227\245\346\234\254\350\252\236"` for a Japanese
 * directory name) as octal byte escapes, and the old `--porcelain` (non `-z`)
 * parser here only stripped the surrounding quotes — it never decoded the
 * escapes, so a nested worktree with a non-ASCII path (e.g.
 * `.claude/worktrees/日本語`) never matched `otherWorktreePaths` and the
 * containing worktree looked dirty forever. `-z` sidesteps the whole
 * problem: entries are NUL-separated and never quoted/escaped, regardless of
 * `core.quotePath`.
 *
 * Each ordinary entry is one NUL-terminated record: `XY PATH\0`. A rename or
 * copy (`R`/`C` in either status column) is followed by one extra
 * NUL-terminated record holding the *old* path — that old-path record is
 * consumed and dropped, since only the destination matters for containment.
 */
const isRenameOrCopyCode = (code: string): boolean => code.includes("R") || code.includes("C");
const RECORDS_PER_RENAME_OR_COPY = 2;
const RECORDS_PER_ORDINARY_ENTRY = 1;

export const parseStatusPaths = (statusOutput: string): string[] => {
  const records = statusOutput.split("\0").filter((record) => record.length > 0);
  const paths: string[] = [];

  let index = 0;
  while (index < records.length) {
    const record = records[index];
    if (record === undefined || record.length <= STATUS_CODE_WIDTH) {
      index += RECORDS_PER_ORDINARY_ENTRY;
    } else {
      paths.push(record.slice(STATUS_CODE_WIDTH));
      // A rename/copy record is followed by one extra record (the old
      // Path) — skip it too, so it's never mistaken for an unrelated
      // Entry's path.
      const code = record.slice(0, STATUS_CODE_WIDTH - 1);
      index += isRenameOrCopyCode(code) ? RECORDS_PER_RENAME_OR_COPY : RECORDS_PER_ORDINARY_ENTRY;
    }
  }

  return paths;
};

const STATUS_CODE_WIDTH = 3;

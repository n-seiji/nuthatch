import { basename, dirname, join } from "node:path";
import { classifyWorktreePath } from "../domain/classify.ts";
import type { Worktree } from "../domain/model.ts";
import { parsePorcelain } from "../domain/porcelain.ts";
import type { FsPort, GitPort } from "../domain/ports.ts";

export interface RepoContext {
  readonly rootPath: string;
  readonly managedRoot: string;
  readonly commonDir: string;
  readonly worktrees: readonly Worktree[];
}

/**
 * Loads and classifies all worktrees for the repo containing `cwd`.
 * The main worktree (root clone) is always the first entry `git worktree
 * list` reports, per git's own behavior.
 */
export const loadRepoContext = async (
  git: GitPort,
  fs: FsPort,
  cwd: string,
): Promise<RepoContext> => {
  const [commonDir, porcelainOut] = await Promise.all([
    git.commonDir(cwd),
    git.listWorktreesPorcelain(cwd),
  ]);

  const parsed = parsePorcelain(porcelainOut);
  const [firstEntry] = parsed;
  if (firstEntry === undefined) {
    throw new Error("git worktree list returned no entries");
  }

  const rootPath = await realpathOrRaw(fs, firstEntry.path);
  const managedRoot = join(dirname(rootPath), "_worktree", basename(rootPath));

  // This map runs once per worktree per repo load. Not a hot path. Spreading
  // Keeps each entry in sync with ParsedWorktree's fields automatically,
  // Instead of enumerating them by hand.
  const worktrees: Worktree[] = await Promise.all(
    // oxlint-disable-next-line oxc/no-map-spread
    parsed.map(async (entry) => {
      const resolvedPath = await realpathOrRaw(fs, entry.path);
      return {
        ...entry,
        path: resolvedPath,
        kind: classifyWorktreePath(resolvedPath, rootPath, managedRoot),
      };
    }),
  );

  return { rootPath, managedRoot, commonDir, worktrees };
};

const realpathOrRaw = async (fs: FsPort, path: string): Promise<string> => {
  try {
    return await fs.realpath(path);
  } catch {
    return path;
  }
};

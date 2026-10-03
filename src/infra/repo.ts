import { basename, dirname, join } from "node:path";
import { classifyWorktreePath, isWithin } from "../domain/classify.ts";
import type { Worktree } from "../domain/model.ts";
import { parsePorcelain } from "../domain/porcelain.ts";
import type { AddWorktreeOptions, FsPort, GitPort } from "../domain/ports.ts";
import { type CommandResult, EXIT_USAGE_ERROR, fail } from "../domain/result.ts";
import { resolveTrackingRef } from "../domain/tracking.ts";

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

/**
 * Registered worktree paths nested *inside* `path`, for excluding
 * nested-worktree noise from a dirty check on `path` (see domain/dirty.ts).
 * `worktrees` must come from `loadRepoContext`, whose paths are already
 * realpath'd, so the comparison in dirty.ts is robust to macOS realpath
 * differences (/var vs /private/var) without resolving again here.
 *
 * Only descendants of `path` are returned — never ancestors (e.g. root,
 * when `path` is a worktree nested under root) and never siblings. A
 * worktree's own dirty status must never be excluded just because it
 * happens to live inside some other, unrelated worktree; only status
 * entries that belong to a worktree nested *inside the target itself* are
 * noise worth filtering out.
 *
 * `prunable` entries are excluded: git already reports those as prunable
 * because their working directory is gone (e.g. `rm -rf`'d without `git
 * worktree prune`), so treating one as a live nested worktree would hide
 * real untracked files that later reappear at that same path from a dirty
 * check — making the containing worktree look clean when it isn't.
 */
export const nestedWorktreePaths = (worktrees: readonly Worktree[], path: string): string[] =>
  nestedWorktrees(worktrees, path).map((wt) => wt.path);

/**
 * Registered worktrees nested *inside* `path` (see nestedWorktreePaths'
 * doc for the descendants-only / prunable-excluded rules — this returns
 * the same set, but as full Worktree records rather than bare paths, for
 * callers that need to report what's inside (see commands/rm.ts and
 * commands/clean.ts: removing a worktree that still contains a live,
 * registered worktree must be refused, since that would destroy the
 * inner worktree's files too).
 */
export const nestedWorktrees = (worktrees: readonly Worktree[], path: string): Worktree[] =>
  worktrees.filter((wt) => wt.path !== path && !wt.prunable && isWithin(path, wt.path));

/** True if the worktree at `path` is dirty, ignoring worktrees nested inside it. */
export const isWorktreeDirty = (
  git: GitPort,
  worktrees: readonly Worktree[],
  path: string,
): Promise<boolean> => git.isDirty(path, nestedWorktreePaths(worktrees, path));

/**
 * Dirty state of `wt`, or null when there is no working tree on disk to
 * inspect (bare, prunable, or its directory is gone): spawning git in a missing
 * directory fails, and "not applicable" must stay distinguishable from "clean".
 */
export const worktreeDirtyState = async (
  git: GitPort,
  fs: FsPort,
  worktrees: readonly Worktree[],
  wt: Worktree,
): Promise<boolean | null> => {
  if (wt.bare || wt.prunable || !(await fs.exists(wt.path))) {
    return null;
  }
  return isWorktreeDirty(git, worktrees, wt.path);
};

export type BranchCheckoutResolution<T> =
  | { readonly ok: true; readonly options: AddWorktreeOptions }
  | { readonly ok: false; readonly rejection: CommandResult<T> };

/**
 * How to check out `branch` for a command that may have to create it
 * (`jump --create`, `root`). `explicitTrack` always wins; otherwise a branch
 * with no local copy tracks the remote branch of the same name. A branch on
 * several remotes, none of them origin, is a usage error rather than a guess.
 */
export const resolveBranchCheckout = async <T>(
  git: GitPort,
  rootPath: string,
  branch: string,
  explicitTrack: string | undefined,
): Promise<BranchCheckoutResolution<T>> => {
  const localBranches = await git.listBranches(rootPath);
  const createBranch = !localBranches.includes(branch);

  let track = explicitTrack;
  if (createBranch && track === undefined) {
    const remotes = await git.remotesWithBranch(rootPath, branch);
    const resolution = resolveTrackingRef(branch, remotes);
    if (resolution.kind === "ambiguous") {
      return {
        ok: false,
        rejection: fail(
          EXIT_USAGE_ERROR,
          `Branch "${branch}" exists on multiple remotes (${remotes.join(", ")}). Use --track to disambiguate.`,
        ),
      };
    }
    if (resolution.kind === "track") {
      track = resolution.ref;
    }
  }

  return { ok: true, options: { createBranch, ...(track === undefined ? {} : { track }) } };
};

const realpathOrRaw = async (fs: FsPort, path: string): Promise<string> => {
  try {
    return await fs.realpath(path);
  } catch {
    return path;
  }
};

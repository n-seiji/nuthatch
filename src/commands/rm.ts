import type { FsPort, GitPort } from "../domain/ports.ts";
import {
  type CommandResult,
  EXIT_GENERAL_ERROR,
  EXIT_SAFE_REJECTION,
  EXIT_USAGE_ERROR,
  fail,
  ok,
} from "../domain/result.ts";
import type { RmData } from "../domain/schema.ts";
import { acquireRepoLock } from "../infra/lock.ts";
import { loadRepoContext, otherWorktreePaths } from "../infra/repo.ts";

export type { RmData } from "../domain/schema.ts";

export interface RmOptions {
  readonly cwd: string;
  readonly branch: string;
  readonly force: boolean;
  readonly ext: boolean;
}

const EXT_DEPRECATION_WARNING =
  "--ext is deprecated and no longer required: hop rm can now remove external worktrees without it.";

const lockedRejection = <T>(branch: string, lockReason: string | null): CommandResult<T> =>
  fail(
    EXIT_SAFE_REJECTION,
    `Worktree for "${branch}" is locked by git${lockReason === null ? "" : ` (${lockReason})`}. hop never unlocks worktrees automatically — run "git worktree unlock" yourself first if you're sure.`,
  );

export const rm = async (
  git: GitPort,
  fs: FsPort,
  options: RmOptions,
): Promise<CommandResult<RmData>> => {
  // --ext is a deprecated no-op kept for backward compatibility: it no
  // Longer gates anything, but every return path still surfaces the warning
  // When it was passed, so callers can migrate off it.
  const finish = <T>(result: CommandResult<T>): CommandResult<T> =>
    options.ext
      ? {
          ...result,
          warnings: [...(result.warnings ?? []), EXT_DEPRECATION_WARNING],
        }
      : result;

  const context = await loadRepoContext(git, fs, options.cwd);
  const target = context.worktrees.find((wt) => wt.branch === options.branch);

  if (target === undefined) {
    return finish(fail(EXIT_GENERAL_ERROR, `No worktree found for branch "${options.branch}".`));
  }

  if (target.kind === "root") {
    return finish(fail(EXIT_USAGE_ERROR, "Cannot remove the root clone."));
  }

  // A worktree git itself reports as locked is always rejected, even with
  // --force — hop must never call `git worktree unlock` on a caller's behalf.
  if (target.locked) {
    return finish(lockedRejection(options.branch, target.lockReason));
  }

  if (!options.force) {
    const dirty = await git.isDirty(
      target.path,
      otherWorktreePaths(context.worktrees, target.path),
    );
    if (dirty) {
      return finish(
        fail(
          EXIT_SAFE_REJECTION,
          `Worktree for "${options.branch}" has uncommitted or untracked changes. Use --force to remove anyway.`,
        ),
      );
    }
  }

  const lock = await acquireRepoLock(context.commonDir);
  try {
    // Re-validate under lock: the worktree may have changed since the check above.
    const fresh = await loadRepoContext(git, fs, options.cwd);
    const freshTarget = fresh.worktrees.find((wt) => wt.branch === options.branch);
    if (freshTarget === undefined) {
      return finish(fail(EXIT_GENERAL_ERROR, `No worktree found for branch "${options.branch}".`));
    }
    if (freshTarget.locked) {
      return finish(lockedRejection(options.branch, freshTarget.lockReason));
    }
    if (!options.force) {
      const stillDirty = await git.isDirty(
        freshTarget.path,
        otherWorktreePaths(fresh.worktrees, freshTarget.path),
      );
      if (stillDirty) {
        return finish(
          fail(
            EXIT_SAFE_REJECTION,
            `Worktree for "${options.branch}" has uncommitted or untracked changes. Use --force to remove anyway.`,
          ),
        );
      }
    }

    await git.removeWorktree(context.rootPath, freshTarget.path, options.force);
    return finish(ok({ data: { branch: options.branch, path: freshTarget.path } }));
  } catch (error) {
    return finish(
      fail(EXIT_SAFE_REJECTION, `Failed to remove worktree: ${(error as Error).message}`),
    );
  } finally {
    await lock.release();
  }
};

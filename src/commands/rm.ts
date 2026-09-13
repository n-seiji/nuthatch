import type { Worktree } from "../domain/model.ts";
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
import { acquireRepoLockOrRejection } from "../infra/lock.ts";
import {
  loadRepoContext,
  nestedWorktrees,
  otherWorktreePaths,
  type RepoContext,
} from "../infra/repo.ts";

export type { RmData } from "../domain/schema.ts";

export interface RmOptions {
  readonly cwd: string;
  readonly branch: string;
  /** Picker-selected path. When present, never remove another worktree that happens to share the branch. */
  readonly expectedPath?: string;
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

const resolveTarget = (
  worktrees: readonly Worktree[],
  branch: string,
  expectedPath?: string,
): { readonly target?: Worktree; readonly rejection?: CommandResult<RmData> } => {
  const matches = worktrees.filter((wt) => wt.branch === branch);
  if (expectedPath !== undefined) {
    const target = matches.find((wt) => wt.path === expectedPath);
    return target === undefined
      ? {
          rejection: fail(
            EXIT_SAFE_REJECTION,
            `The selected worktree for "${branch}" changed before removal. Refresh the picker and retry.`,
          ),
        }
      : { target };
  }
  if (matches.length > 1) {
    return {
      rejection: fail(
        EXIT_SAFE_REJECTION,
        `Branch "${branch}" is checked out at ${matches.length} worktrees (${matches.map((wt) => wt.path).join(", ")}). Refusing to guess which one to remove.`,
      ),
    };
  }
  const [target] = matches;
  return target === undefined ? {} : { target };
};

/**
 * Rejects removing `target` when it still contains one or more registered
 * worktrees — regardless of `--force`, and regardless of whether those inner
 * worktrees are clean, dirty, or git-locked. Removing the parent would
 * destroy the inner worktree's files too, which is exactly the kind of
 * destructive surprise the "always refuse git-locked, --force or not" rule
 * exists to prevent — that rule must hold just as strongly when the nesting
 * is what's hiding it. `hop clean`'s automatic deletion path goes through
 * this same check (see commands/clean.ts).
 */
const nestedWorktreeRejection = <T>(
  branch: string,
  targetPath: string,
  worktrees: readonly Worktree[],
): CommandResult<T> | null => {
  const nested = nestedWorktrees(worktrees, targetPath);
  if (nested.length === 0) {
    return null;
  }
  const listing = nested
    .map((wt) => `  ${wt.path}${wt.branch === null ? "" : ` (${wt.branch})`}`)
    .join("\n");
  return fail(
    EXIT_SAFE_REJECTION,
    `Worktree for "${branch}" still contains ${nested.length} registered worktree(s) — refusing to remove it, since that would destroy their files too. Remove these first, then retry:\n${listing}`,
  );
};

const targetSafetyRejection = async (
  git: GitPort,
  context: RepoContext,
  target: Worktree,
  options: RmOptions,
): Promise<CommandResult<RmData> | null> => {
  const nestedRejection = nestedWorktreeRejection<RmData>(
    options.branch,
    target.path,
    context.worktrees,
  );
  if (nestedRejection !== null) {
    return nestedRejection;
  }
  if (target.locked) {
    return lockedRejection(options.branch, target.lockReason);
  }
  if (
    !options.force &&
    (await git.isDirty(target.path, otherWorktreePaths(context.worktrees, target.path)))
  ) {
    return fail(
      EXIT_SAFE_REJECTION,
      `Worktree for "${options.branch}" has uncommitted or untracked changes. Use --force to remove anyway.`,
    );
  }
  return null;
};

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
  const resolved = resolveTarget(context.worktrees, options.branch, options.expectedPath);
  if (resolved.rejection !== undefined) {
    return finish(resolved.rejection);
  }
  const { target } = resolved;

  if (target === undefined) {
    return finish(fail(EXIT_GENERAL_ERROR, `No worktree found for branch "${options.branch}".`));
  }

  if (target.kind === "root") {
    return finish(fail(EXIT_USAGE_ERROR, "Cannot remove the root clone."));
  }

  const safetyRejection = await targetSafetyRejection(git, context, target, options);
  if (safetyRejection !== null) {
    return finish(safetyRejection);
  }

  const acquisition = await acquireRepoLockOrRejection<RmData>(context.commonDir);
  if (!acquisition.ok) {
    return finish(acquisition.rejection);
  }
  const { lock } = acquisition;
  try {
    // Re-validate under lock: the worktree may have changed since the check above.
    const fresh = await loadRepoContext(git, fs, options.cwd);
    const freshResolved = resolveTarget(fresh.worktrees, options.branch, options.expectedPath);
    if (freshResolved.rejection !== undefined) {
      return finish(freshResolved.rejection);
    }
    const freshTarget = freshResolved.target;
    if (freshTarget === undefined) {
      return finish(fail(EXIT_GENERAL_ERROR, `No worktree found for branch "${options.branch}".`));
    }
    const freshSafetyRejection = await targetSafetyRejection(git, fresh, freshTarget, options);
    if (freshSafetyRejection !== null) {
      return finish(freshSafetyRejection);
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

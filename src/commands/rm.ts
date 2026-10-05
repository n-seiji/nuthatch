import { messageOf } from "../domain/fatal-error.ts";
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
import { withRepoLock } from "../infra/lock.ts";
import {
  loadRepoContext,
  nestedWorktrees,
  type RepoContext,
  worktreeDirtyState,
} from "../infra/repo.ts";

export interface RmOptions {
  readonly cwd: string;
  readonly branch: string;
  /** Picker-selected path. When present, never remove another worktree that happens to share the branch. */
  readonly expectedPath?: string;
  /**
   * False for picker actions that have not confirmed removing a prunable worktree.
   * Undefined means allowed, which is what the CLI's `hop rm` uses.
   */
  readonly allowPrunable?: boolean;
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

const turnedPrunableRejection = (branch: string): CommandResult<RmData> =>
  fail(
    EXIT_SAFE_REJECTION,
    `The selected worktree for "${branch}" changed before removal (git now reports it prunable). Refresh the picker and retry.`,
  );

/**
 * Prunable also covers a directory moved by hand without `git worktree move`;
 * dropping the registration loses its index/link, so the user is told.
 */
const stalePrunableWarning = ({ path, prunableReason }: Worktree): string =>
  `Worktree at ${path} no longer exists${prunableReason === null ? "" : ` (${prunableReason})`}; removed its stale registration — if it had been moved by hand, the moved copy is no longer linked to this repository.`;

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

interface RemovalCheck {
  readonly git: GitPort;
  readonly fs: FsPort;
  readonly context: RepoContext;
  readonly options: RmOptions;
}

const targetSafetyRejection = async (
  { git, fs, context, options }: RemovalCheck,
  target: Worktree,
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
  // A prunable target is never dirty-checked, so only a caller that confirmed it may remove one.
  if (target.prunable && options.allowPrunable === false) {
    return turnedPrunableRejection(options.branch);
  }
  // Only a definite "dirty" refuses: null (no working tree on disk) leaves removal to git.
  if (!options.force && (await worktreeDirtyState(git, fs, context.worktrees, target)) === true) {
    return fail(
      EXIT_SAFE_REJECTION,
      `Worktree for "${options.branch}" has uncommitted or untracked changes. Use --force to remove anyway.`,
    );
  }
  return null;
};

type RemovalValidation =
  | { readonly ok: true; readonly target: Worktree }
  | { readonly ok: false; readonly rejection: CommandResult<RmData> };

const validateRemoval = async (check: RemovalCheck): Promise<RemovalValidation> => {
  const { context, options } = check;
  const resolved = resolveTarget(context.worktrees, options.branch, options.expectedPath);
  if (resolved.rejection !== undefined) {
    return { ok: false, rejection: resolved.rejection };
  }
  const { target } = resolved;
  if (target === undefined) {
    return {
      ok: false,
      rejection: fail(EXIT_GENERAL_ERROR, `No worktree found for branch "${options.branch}".`),
    };
  }
  if (target.kind === "root") {
    return { ok: false, rejection: fail(EXIT_USAGE_ERROR, "Cannot remove the root clone.") };
  }
  const rejection = await targetSafetyRejection(check, target);
  return rejection === null ? { ok: true, target } : { ok: false, rejection };
};

/*
 * --ext is a deprecated no-op kept for backward compatibility: it no longer
 * gates anything, but every return path still surfaces the warning when it
 * was passed, so callers can migrate off it.
 */
const withExtWarning = (ext: boolean, result: CommandResult<RmData>): CommandResult<RmData> =>
  ext
    ? {
        ...result,
        warnings: [...(result.warnings ?? []), EXT_DEPRECATION_WARNING],
      }
    : result;

const removeWorktree = async (
  git: GitPort,
  fs: FsPort,
  options: RmOptions,
): Promise<CommandResult<RmData>> => {
  const context = await loadRepoContext(git, fs, options.cwd);
  const validation = await validateRemoval({ git, fs, context, options });
  if (!validation.ok) {
    return validation.rejection;
  }

  return withRepoLock<RmData>(context.commonDir, async () => {
    try {
      // Re-validate under lock: the worktree may have changed since the check above.
      const fresh = await loadRepoContext(git, fs, options.cwd);
      const freshValidation = await validateRemoval({ git, fs, context: fresh, options });
      if (!freshValidation.ok) {
        return freshValidation.rejection;
      }
      const { target } = freshValidation;

      await git.removeWorktree(context.rootPath, target.path, options.force);
      return ok({
        data: { branch: options.branch, path: target.path },
        ...(target.prunable ? { warnings: [stalePrunableWarning(target)] } : {}),
      });
    } catch (error) {
      return fail(EXIT_SAFE_REJECTION, `Failed to remove worktree: ${messageOf(error)}`);
    }
  });
};

export const rm = async (
  git: GitPort,
  fs: FsPort,
  options: RmOptions,
): Promise<CommandResult<RmData>> =>
  withExtWarning(options.ext, await removeWorktree(git, fs, options));

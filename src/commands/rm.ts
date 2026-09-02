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
import { loadRepoContext } from "../infra/repo.ts";

export type { RmData } from "../domain/schema.ts";

export interface RmOptions {
  readonly cwd: string;
  readonly branch: string;
  readonly force: boolean;
  readonly ext: boolean;
}

export const rm = async (
  git: GitPort,
  fs: FsPort,
  options: RmOptions,
): Promise<CommandResult<RmData>> => {
  const context = await loadRepoContext(git, fs, options.cwd);
  const target = context.worktrees.find((wt) => wt.branch === options.branch);

  if (target === undefined) {
    return fail(EXIT_GENERAL_ERROR, `No worktree found for branch "${options.branch}".`);
  }

  if (target.kind === "root") {
    return fail(EXIT_USAGE_ERROR, "Cannot remove the root clone.");
  }

  if (target.kind === "external" && !(options.ext && options.force)) {
    return fail(
      EXIT_SAFE_REJECTION,
      `"${options.branch}" is an external worktree not managed by nuthatch. Removal requires both --ext and --force.`,
    );
  }

  if (!options.force) {
    const dirty = await git.isDirty(target.path);
    if (dirty) {
      return fail(
        EXIT_SAFE_REJECTION,
        `Worktree for "${options.branch}" has uncommitted or untracked changes. Use --force to remove anyway.`,
      );
    }
  }

  const lock = await acquireRepoLock(context.commonDir);
  try {
    // Re-validate under lock: the worktree may have changed since the check above.
    const fresh = await loadRepoContext(git, fs, options.cwd);
    const freshTarget = fresh.worktrees.find((wt) => wt.branch === options.branch);
    if (freshTarget === undefined) {
      return fail(EXIT_GENERAL_ERROR, `No worktree found for branch "${options.branch}".`);
    }
    if (!options.force) {
      const stillDirty = await git.isDirty(freshTarget.path);
      if (stillDirty) {
        return fail(
          EXIT_SAFE_REJECTION,
          `Worktree for "${options.branch}" has uncommitted or untracked changes. Use --force to remove anyway.`,
        );
      }
    }

    await git.removeWorktree(context.rootPath, freshTarget.path, options.force);
    return ok({ data: { branch: options.branch, path: freshTarget.path } });
  } catch (error) {
    return fail(EXIT_SAFE_REJECTION, `Failed to remove worktree: ${(error as Error).message}`);
  } finally {
    await lock.release();
  }
};

import type { FsPort, GitPort } from "../domain/ports.ts";
import { type CommandResult, fail, ok } from "../domain/result.ts";
import { acquireRepoLock } from "../infra/lock.ts";
import { loadRepoContext } from "../infra/repo.ts";

export interface RmOptions {
  readonly cwd: string;
  readonly branch: string;
  readonly force: boolean;
  readonly ext: boolean;
}

export interface RmData {
  readonly branch: string;
  readonly path: string;
}

export const rm = async (
  git: GitPort,
  fs: FsPort,
  options: RmOptions,
): Promise<CommandResult<RmData>> => {
  const context = await loadRepoContext(git, fs, options.cwd);
  const target = context.worktrees.find((wt) => wt.branch === options.branch);

  if (target === undefined) {
    return fail(1, `No worktree found for branch "${options.branch}".`);
  }

  if (target.kind === "root") {
    return fail(2, "Cannot remove the root clone.");
  }

  if (target.kind === "external" && !(options.ext && options.force)) {
    return fail(
      3,
      `"${options.branch}" is an external worktree not managed by nuthatch. Removal requires both --ext and --force.`,
    );
  }

  if (!options.force) {
    const dirty = await git.isDirty(target.path);
    if (dirty) {
      return fail(
        3,
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
      return fail(1, `No worktree found for branch "${options.branch}".`);
    }
    if (!options.force) {
      const stillDirty = await git.isDirty(freshTarget.path);
      if (stillDirty) {
        return fail(
          3,
          `Worktree for "${options.branch}" has uncommitted or untracked changes. Use --force to remove anyway.`,
        );
      }
    }

    await git.removeWorktree(context.rootPath, freshTarget.path, options.force);
    return ok({ data: { branch: options.branch, path: freshTarget.path } });
  } catch (err) {
    return fail(3, `Failed to remove worktree: ${(err as Error).message}`);
  } finally {
    await lock.release();
  }
};

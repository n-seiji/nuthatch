import { join } from "node:path";
import { messageOf } from "../domain/fatal-error.ts";
import type { FsPort, GitPort } from "../domain/ports.ts";
import {
  type CommandResult,
  EXIT_GENERAL_ERROR,
  EXIT_SAFE_REJECTION,
  fail,
  ok,
} from "../domain/result.ts";
import type { JumpData } from "../domain/schema.ts";
import { sanitizeBranchName } from "../domain/sanitize.ts";
import { acquireRepoLock } from "../infra/lock.ts";
import { loadRepoContext, resolveBranchCheckout } from "../infra/repo.ts";

export type { JumpData } from "../domain/schema.ts";

export interface JumpOptions {
  readonly cwd: string;
  readonly target: string;
  readonly create: boolean;
  readonly track?: string;
}

const existingWorktreeResult = (branch: string, path: string): CommandResult<JumpData> =>
  ok({ path, data: { branch, created: false } });

export const jump = async (
  git: GitPort,
  fs: FsPort,
  options: JumpOptions,
): Promise<CommandResult<JumpData>> => {
  if (options.target === "-") {
    const previous = process.env.OLDPWD;
    if (previous === undefined || previous.length === 0) {
      return fail(EXIT_GENERAL_ERROR, "No previous worktree recorded (OLDPWD is unset).");
    }
    return ok({
      path: previous,
      data: { branch: options.target, created: false },
    });
  }

  const context = await loadRepoContext(git, fs, options.cwd);

  const existing = context.worktrees.find((wt) => wt.branch === options.target);
  if (existing !== undefined) {
    return existingWorktreeResult(options.target, existing.path);
  }

  if (!options.create) {
    return fail(
      EXIT_SAFE_REJECTION,
      `No worktree for branch "${options.target}". Re-run with --create to create it.`,
    );
  }

  const checkout = await resolveBranchCheckout<JumpData>(
    git,
    context.rootPath,
    options.target,
    options.track,
  );
  if (!checkout.ok) {
    return checkout.rejection;
  }

  const managedDirNames = await fs.listDirNames(context.managedRoot);
  const existingDirNames = new Set(managedDirNames.map((name) => name.toLowerCase()));
  const dirName = sanitizeBranchName(options.target, (candidate) =>
    existingDirNames.has(candidate.toLowerCase()),
  );
  const targetPath = join(context.managedRoot, dirName);

  const lock = await acquireRepoLock(context.commonDir);
  try {
    // Re-validate under lock: another process may have created it concurrently.
    const fresh = await loadRepoContext(git, fs, options.cwd);
    const racedExisting = fresh.worktrees.find((wt) => wt.branch === options.target);
    if (racedExisting !== undefined) {
      return existingWorktreeResult(options.target, racedExisting.path);
    }

    await fs.mkdir(context.managedRoot);
    await git.addWorktree(context.rootPath, targetPath, options.target, checkout.options);
  } catch (error) {
    return fail(EXIT_SAFE_REJECTION, `Failed to create worktree: ${messageOf(error)}`);
  } finally {
    await lock.release();
  }

  return ok({
    path: targetPath,
    data: { branch: options.target, created: true },
  });
};

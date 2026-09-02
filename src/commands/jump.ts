import { join } from "node:path";
import type { FsPort, GitPort, TermPort } from "../domain/ports.ts";
import { type CommandResult, fail, ok } from "../domain/result.ts";
import { sanitizeBranchName } from "../domain/sanitize.ts";
import { acquireRepoLock } from "../infra/lock.ts";
import { loadRepoContext } from "../infra/repo.ts";

export interface JumpOptions {
  readonly cwd: string;
  readonly target: string;
  readonly create: boolean;
  readonly track?: string;
}

export interface JumpData {
  readonly branch: string;
  readonly created: boolean;
}

export const jump = async (
  git: GitPort,
  fs: FsPort,
  term: TermPort,
  options: JumpOptions,
): Promise<CommandResult<JumpData>> => {
  if (options.target === "-") {
    const previous = process.env.OLDPWD;
    if (previous === undefined || previous.length === 0) {
      return fail(1, "No previous worktree recorded (OLDPWD is unset).");
    }
    return ok({
      path: previous,
      data: { branch: options.target, created: false },
    });
  }

  const context = await loadRepoContext(git, fs, options.cwd);

  if (options.target === "root") {
    return ok({
      path: context.rootPath,
      data: { branch: "root", created: false },
    });
  }

  const existing = context.worktrees.find((wt) => wt.branch === options.target);
  if (existing !== undefined) {
    return ok({
      path: existing.path,
      data: { branch: options.target, created: false },
    });
  }

  if (!options.create) {
    if (!term.isTTY()) {
      return fail(
        3,
        `No worktree for branch "${options.target}". Re-run with --create to create it.`,
      );
    }
    return fail(
      3,
      `No worktree for branch "${options.target}". Re-run with --create to create it.`,
    );
  }

  const localBranches = await git.listBranches(context.rootPath);
  const branchExistsLocally = localBranches.includes(options.target);

  let track: string | undefined = options.track;
  if (!branchExistsLocally && track === undefined) {
    const remotes = await git.remotesWithBranch(context.rootPath, options.target);
    if (remotes.includes("origin")) {
      track = `origin/${options.target}`;
    } else if (remotes.length === 1) {
      track = `${remotes[0]}/${options.target}`;
    } else if (remotes.length > 1) {
      return fail(
        2,
        `Branch "${options.target}" exists on multiple remotes (${remotes.join(", ")}). Use --track to disambiguate.`,
      );
    }
  }

  const existingDirNames = new Set(
    (await fs.listDirNames(context.managedRoot)).map((n) => n.toLowerCase()),
  );
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
      return ok({
        path: racedExisting.path,
        data: { branch: options.target, created: false },
      });
    }

    await fs.mkdir(context.managedRoot);
    await git.addWorktree(context.rootPath, targetPath, options.target, {
      createBranch: !branchExistsLocally,
      ...(track !== undefined ? { track } : {}),
    });
  } catch (err) {
    return fail(3, `Failed to create worktree: ${(err as Error).message}`);
  } finally {
    await lock.release();
  }

  return ok({
    path: targetPath,
    data: { branch: options.target, created: true },
  });
};

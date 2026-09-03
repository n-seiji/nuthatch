import { join } from "node:path";
import type { FsPort, GitPort, TermPort } from "../domain/ports.ts";
import {
  type CommandResult,
  EXIT_GENERAL_ERROR,
  EXIT_SAFE_REJECTION,
  EXIT_USAGE_ERROR,
  fail,
  ok,
} from "../domain/result.ts";
import type { JumpData } from "../domain/schema.ts";
import { sanitizeBranchName } from "../domain/sanitize.ts";
import { acquireRepoLock } from "../infra/lock.ts";
import { loadRepoContext } from "../infra/repo.ts";

export type { JumpData } from "../domain/schema.ts";

export interface JumpOptions {
  readonly cwd: string;
  readonly target: string;
  readonly create: boolean;
  readonly track?: string;
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
      return fail(EXIT_GENERAL_ERROR, "No previous worktree recorded (OLDPWD is unset).");
    }
    return ok({
      path: previous,
      data: { branch: options.target, created: false },
    });
  }

  const context = await loadRepoContext(git, fs, options.cwd);

  // "Root" is never reached here in practice — it's a reserved word cli.ts
  // Dispatches to commands/root.ts before jump ever sees it. Kept out of
  // This function entirely now that root.ts owns that behavior.

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
        EXIT_SAFE_REJECTION,
        `No worktree for branch "${options.target}". Re-run with --create to create it.`,
      );
    }
    return fail(
      EXIT_SAFE_REJECTION,
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
        EXIT_USAGE_ERROR,
        `Branch "${options.target}" exists on multiple remotes (${remotes.join(", ")}). Use --track to disambiguate.`,
      );
    }
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
      return ok({
        path: racedExisting.path,
        data: { branch: options.target, created: false },
      });
    }

    await fs.mkdir(context.managedRoot);
    await git.addWorktree(context.rootPath, targetPath, options.target, {
      createBranch: !branchExistsLocally,
      ...(track === undefined ? {} : { track }),
    });
  } catch (error) {
    return fail(EXIT_SAFE_REJECTION, `Failed to create worktree: ${(error as Error).message}`);
  } finally {
    await lock.release();
  }

  return ok({
    path: targetPath,
    data: { branch: options.target, created: true },
  });
};

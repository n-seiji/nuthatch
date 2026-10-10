import type { FsPort, GitPort } from "../domain/ports.ts";
import {
  type CommandResult,
  EXIT_GENERAL_ERROR,
  EXIT_SAFE_REJECTION,
  fail,
  ok,
} from "../domain/result.ts";
import type { StatusData } from "../domain/schema.ts";
import { resolveStatusTarget } from "../domain/status-target.ts";
import { loadRepoContext, worktreeChanges } from "../infra/repo.ts";
import { classifyCleanReason } from "./clean-candidates.ts";

export interface StatusOptions {
  readonly cwd: string;
  /** Worktree to report on; without one, the worktree containing `cwd`. */
  readonly branch?: string;
}

/**
 * `hop status [<branch>]` — one worktree in detail: everything `hop ls`
 * reports for it, plus its uncommitted changes, HEAD commit, upstream, and
 * the reason `hop clean` would give for it. Read-only: it takes no lock and
 * changes nothing, so it is safe to call as often as an agent likes.
 */
export const status = async (
  git: GitPort,
  fs: FsPort,
  options: StatusOptions,
): Promise<CommandResult<StatusData>> => {
  const context = await loadRepoContext(git, fs, options.cwd);
  const target = resolveStatusTarget(
    context.worktrees,
    options.branch === undefined
      ? { cwdPath: await fs.realpath(options.cwd) }
      : { branch: options.branch },
  );
  if (target.kind === "notFound") {
    return fail(EXIT_GENERAL_ERROR, target.message);
  }
  if (target.kind === "ambiguous") {
    return fail(EXIT_SAFE_REJECTION, target.message);
  }

  const wt = target.worktree;
  const { rootPath } = context;
  const [changes, aheadBehind, upstream, lastCommit, defaultRef] = await Promise.all([
    worktreeChanges(git, fs, context.worktrees, wt),
    wt.branch === null ? Promise.resolve(null) : git.aheadBehind(rootPath, wt.branch),
    wt.branch === null ? Promise.resolve(null) : git.upstreamOf(rootPath, wt.branch),
    // Read from the root clone by sha, so a prunable worktree (no directory
    // Left to run git in) still reports the commit it was on.
    wt.head === null ? Promise.resolve(null) : git.commitInfo(rootPath, wt.head),
    git.resolveDefaultBranchRef(rootPath),
  ]);
  const cleanReason = await classifyCleanReason(wt, { git, fs, defaultRef, context });

  return ok({
    data: {
      ...wt,
      dirty: changes !== null && changes.length > 0,
      ahead: aheadBehind?.ahead ?? null,
      behind: aheadBehind?.behind ?? null,
      upstream,
      lastCommit,
      changes: changes ?? [],
      cleanReason,
    },
  });
};

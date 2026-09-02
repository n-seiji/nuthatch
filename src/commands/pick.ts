import { buildPickCandidates, type PickCandidate } from "../domain/candidates.ts";
import type { FsPort, GitPort } from "../domain/ports.ts";
import { type CommandResult, ok } from "../domain/result.ts";
import { loadRepoContext } from "../infra/repo.ts";

export type { PickCandidate } from "../domain/candidates.ts";

export interface PickOptions {
  readonly cwd: string;
}

export interface PickData {
  readonly candidates: readonly PickCandidate[];
}

/**
 * Loads everything the interactive picker needs to render: every worktree
 * (with dirty status) plus every branch that doesn't have one yet. Does not
 * render anything — cli.ts hands this to ui/picker.tsx.
 */
export const pick = async (
  git: GitPort,
  fs: FsPort,
  options: PickOptions,
): Promise<CommandResult<PickData>> => {
  const context = await loadRepoContext(git, fs, options.cwd);

  const [localBranches, remoteBranches, dirtyEntries] = await Promise.all([
    git.listBranches(context.rootPath),
    git.listRemoteBranches(context.rootPath),
    Promise.all(
      context.worktrees.map(async (worktree): Promise<readonly [string, boolean]> => [
        worktree.path,
        worktree.bare ? false : await git.isDirty(worktree.path),
      ]),
    ),
  ]);

  const dirtyByPath = new Map(dirtyEntries);
  const candidates = buildPickCandidates(
    context.worktrees,
    dirtyByPath,
    localBranches,
    remoteBranches,
  );

  return ok({ data: { candidates } });
};

import type { Worktree } from "../domain/model.ts";
import type { FsPort, GitPort } from "../domain/ports.ts";
import { type CommandResult, ok } from "../domain/result.ts";
import { loadRepoContext } from "../infra/repo.ts";

export interface LsEntry extends Worktree {
  readonly dirty: boolean;
  readonly ahead: number | null;
  readonly behind: number | null;
}

export interface LsOptions {
  readonly cwd: string;
}

export const ls = async (
  git: GitPort,
  fs: FsPort,
  options: LsOptions,
): Promise<CommandResult<LsEntry[]>> => {
  const context = await loadRepoContext(git, fs, options.cwd);

  const entries = await Promise.all(
    context.worktrees.map(async (wt): Promise<LsEntry> => {
      const [dirty, aheadBehind] = await Promise.all([
        wt.bare ? Promise.resolve(false) : git.isDirty(wt.path),
        wt.branch !== null ? git.aheadBehind(context.rootPath, wt.branch) : Promise.resolve(null),
      ]);
      return {
        ...wt,
        dirty,
        ahead: aheadBehind?.ahead ?? null,
        behind: aheadBehind?.behind ?? null,
      };
    }),
  );

  return ok({ data: entries });
};

import type { FsPort, GitPort } from "../domain/ports.ts";
import { type CommandResult, ok } from "../domain/result.ts";
import type { LsEntry } from "../domain/schema.ts";
import { loadRepoContext } from "../infra/repo.ts";

export type { LsEntry } from "../domain/schema.ts";

export interface LsOptions {
  readonly cwd: string;
}

export const ls = async (
  git: GitPort,
  fs: FsPort,
  options: LsOptions,
): Promise<CommandResult<LsEntry[]>> => {
  const context = await loadRepoContext(git, fs, options.cwd);

  // This map runs once per worktree (a handful at most) per `ls` invocation.
  // Not a hot path. Spreading keeps each entry in sync with Worktree's fields
  // Automatically. Enumerating every field by hand would be more verbose and
  // Would silently drop new ones later.
  const entries = await Promise.all(
    // oxlint-disable-next-line oxc/no-map-spread
    context.worktrees.map(async (wt): Promise<LsEntry> => {
      const [dirty, aheadBehind] = await Promise.all([
        wt.bare ? Promise.resolve(false) : git.isDirty(wt.path),
        wt.branch === null ? Promise.resolve(null) : git.aheadBehind(context.rootPath, wt.branch),
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

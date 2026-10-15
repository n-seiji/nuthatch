import type { FsPort, GitPort } from "../domain/ports.ts";
import { type CommandResult, ok } from "../domain/result.ts";
import type { LsEntry } from "../domain/schema.ts";
import { upstreamStateOf } from "../domain/upstream.ts";
import { loadRepoContext, worktreeDirtyState } from "../infra/repo.ts";

export interface LsOptions {
  readonly cwd: string;
}

export const ls = async (
  git: GitPort,
  fs: FsPort,
  options: LsOptions,
): Promise<CommandResult<LsEntry[]>> => {
  const context = await loadRepoContext(git, fs, options.cwd);
  const upstreams = git.upstreamStates(context.rootPath);

  // This map runs once per worktree (a handful at most) per `ls` invocation.
  // Not a hot path. Spreading keeps each entry in sync with Worktree's fields
  // Automatically. Enumerating every field by hand would be more verbose and
  // Would silently drop new ones later.
  const entries = await Promise.all(
    // oxlint-disable-next-line oxc/no-map-spread
    context.worktrees.map(async (wt): Promise<LsEntry> => {
      const [dirtyState, states] = await Promise.all([
        worktreeDirtyState(git, fs, context.worktrees, wt),
        upstreams,
      ]);
      const upstream = wt.branch === null ? null : upstreamStateOf(states, wt.branch);
      const tracking = upstream?.kind === "tracking" ? upstream : null;
      return {
        ...wt,
        dirty: dirtyState ?? false,
        ahead: tracking?.ahead ?? null,
        behind: tracking?.behind ?? null,
      };
    }),
  );

  return ok({ data: entries });
};

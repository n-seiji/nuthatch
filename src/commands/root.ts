import type { FsPort, GitPort } from "../domain/ports.ts";
import {
  type CommandResult,
  EXIT_SAFE_REJECTION,
  EXIT_USAGE_ERROR,
  fail,
  ok,
} from "../domain/result.ts";
import type { RootData } from "../domain/schema.ts";
import { acquireRepoLock } from "../infra/lock.ts";
import { loadRepoContext } from "../infra/repo.ts";

export type { RootData } from "../domain/schema.ts";

export interface RootOptions {
  readonly cwd: string;
  /** Undefined: bare `hop root` (just navigate). "-": switch back (@{-1}). Otherwise a branch name. */
  readonly target?: string;
  readonly track?: string;
}

/**
 * `hop root` — bare form just reports the root clone's path (like `hop
 * root` navigation). With a branch (or "-"), temporarily switches the root
 * clone's checked-out branch for verification purposes (docs/design.md's
 * "hop root — 動作確認セッション"), refusing if root is dirty or the target
 * branch is already checked out elsewhere.
 */
export const root = async (
  git: GitPort,
  fs: FsPort,
  options: RootOptions,
): Promise<CommandResult<RootData>> => {
  const context = await loadRepoContext(git, fs, options.cwd);
  const rootWorktree = context.worktrees.find((wt) => wt.kind === "root");

  if (options.target === undefined) {
    return ok({
      path: context.rootPath,
      data: { branch: rootWorktree?.branch ?? null, switched: false },
    });
  }

  const dirty = await git.isDirty(context.rootPath);
  if (dirty) {
    return fail(
      EXIT_SAFE_REJECTION,
      "Root clone has uncommitted or untracked changes. Commit, stash, or discard them before switching.",
    );
  }

  const previousBranch = rootWorktree?.branch ?? null;

  if (options.target === "-") {
    return switchAndReport({
      git,
      fs,
      context,
      target: "-",
      switchOptions: {},
      previousBranch,
    });
  }

  const holder = context.worktrees.find((wt) => wt.branch === options.target && wt.kind !== "root");
  if (holder !== undefined) {
    return fail(
      EXIT_SAFE_REJECTION,
      `Branch "${options.target}" is already checked out at ${holder.path}. Not swapping — cd there instead of using hop root.`,
    );
  }

  const localBranches = await git.listBranches(context.rootPath);
  const branchExistsLocally = localBranches.includes(options.target);

  const { track: initialTrack } = options;
  let track = initialTrack;
  if (!branchExistsLocally && track === undefined) {
    const remotes = await git.remotesWithBranch(context.rootPath, options.target);
    const [firstRemote] = remotes;
    if (remotes.includes("origin")) {
      track = `origin/${options.target}`;
    } else if (remotes.length === 1 && firstRemote !== undefined) {
      track = `${firstRemote}/${options.target}`;
    } else if (remotes.length > 1) {
      return fail(
        EXIT_USAGE_ERROR,
        `Branch "${options.target}" exists on multiple remotes (${remotes.join(", ")}). Use --track to disambiguate.`,
      );
    }
  }

  return switchAndReport({
    git,
    fs,
    context,
    target: options.target,
    switchOptions: {
      createBranch: !branchExistsLocally,
      ...(track === undefined ? {} : { track }),
    },
    previousBranch,
  });
};

interface SwitchAndReportOptions {
  readonly git: GitPort;
  readonly fs: FsPort;
  readonly context: Awaited<ReturnType<typeof loadRepoContext>>;
  readonly target: string;
  readonly switchOptions: { createBranch?: boolean; track?: string };
  readonly previousBranch: string | null;
}

const switchAndReport = async ({
  git,
  fs,
  context,
  target,
  switchOptions,
  previousBranch,
}: SwitchAndReportOptions): Promise<CommandResult<RootData>> => {
  const lock = await acquireRepoLock(context.commonDir);
  try {
    // Re-validate under lock: root may have gone dirty, or another process
    // May have started checking out the target branch, since the checks above.
    const fresh = await loadRepoContext(git, fs, context.rootPath);
    const stillDirty = await git.isDirty(fresh.rootPath);
    if (stillDirty) {
      return fail(
        EXIT_SAFE_REJECTION,
        "Root clone has uncommitted or untracked changes. Commit, stash, or discard them before switching.",
      );
    }
    if (target !== "-") {
      const freshHolder = fresh.worktrees.find((wt) => wt.branch === target && wt.kind !== "root");
      if (freshHolder !== undefined) {
        return fail(
          EXIT_SAFE_REJECTION,
          `Branch "${target}" is already checked out at ${freshHolder.path}. Not swapping — cd there instead of using hop root.`,
        );
      }
    }

    await git.switchBranch(fresh.rootPath, target, switchOptions);
    return ok({
      path: fresh.rootPath,
      data: { branch: target === "-" ? null : target, switched: true },
    });
  } catch (error) {
    // Best-effort rollback: try to restore the branch root was on before this
    // Call, in case the switch partially applied (e.g. created a new local
    // Branch via -c and then failed setting it up). Failure here is swallowed
    // — We're already reporting the original error, and there is nothing more
    // Useful to do than leave root on whatever branch it ended up on.
    if (previousBranch !== null) {
      try {
        await git.switchBranch(context.rootPath, previousBranch, {});
      } catch {
        // Ignore: see comment above.
      }
    }
    return fail(EXIT_SAFE_REJECTION, `Failed to switch root: ${(error as Error).message}`);
  } finally {
    await lock.release();
  }
};

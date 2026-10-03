import { messageOf } from "../domain/fatal-error.ts";
import type { FsPort, GitPort, SwitchBranchOptions } from "../domain/ports.ts";
import { type CommandResult, EXIT_SAFE_REJECTION, fail, ok } from "../domain/result.ts";
import type { RootData } from "../domain/schema.ts";
import { withRepoLock } from "../infra/lock.ts";
import {
  isWorktreeDirty,
  loadRepoContext,
  type RepoContext,
  resolveBranchCheckout,
} from "../infra/repo.ts";
import {
  type DetachedHolder,
  type HolderSwapPolicy,
  resolveHolderSwap,
} from "./root-holder-swap.ts";

export interface RootOptions {
  readonly cwd: string;
  /** Undefined: bare `hop root` (just navigate). "-": switch back (@{-1}). Otherwise a branch name. */
  readonly target?: string;
  readonly track?: string;
  /** False for picker actions that have not confirmed mutating a freshly discovered external holder. */
  readonly allowExternalHolderSwap?: boolean;
  /** Picker-selected holder path, used to reject a different holder discovered under the repo lock. */
  readonly expectedHolderPath?: string;
}

/**
 * `hop root` — bare form just reports the root clone's path (like `hop
 * root` navigation). With a branch (or "-"), temporarily switches the root
 * clone's checked-out branch for verification purposes (docs/design.md's
 * "hop root — verification session"), refusing if root is dirty. If the target
 * branch is already checked out on another (managed or external) worktree —
 * the "holder" — and that holder is clean and not locked by git, its HEAD is
 * detached to free up the branch (see resolveHolderSwap in
 * root-holder-swap.ts); a dirty or git-locked holder still refuses the
 * switch entirely, as before.
 */
export const root = async (
  git: GitPort,
  fs: FsPort,
  options: RootOptions,
): Promise<CommandResult<RootData>> => {
  const context = await loadRepoContext(git, fs, options.cwd);

  if (options.target === undefined) {
    return ok({
      path: context.rootPath,
      data: {
        branch: rootBranchOf(context),
        switched: false,
        detachedHolder: null,
      },
    });
  }

  const dirtyRejection = await dirtyRootRejection(git, context);
  if (dirtyRejection !== null) {
    return dirtyRejection;
  }

  if (options.target === "-") {
    return switchAndReport({
      git,
      fs,
      context,
      target: "-",
      switchOptions: {},
      holderPolicy: { allowExternal: true },
    });
  }

  const checkout = await resolveBranchCheckout<RootData>(
    git,
    context.rootPath,
    options.target,
    options.track,
  );
  if (!checkout.ok) {
    return checkout.rejection;
  }

  return switchAndReport({
    git,
    fs,
    context,
    target: options.target,
    switchOptions: checkout.options,
    holderPolicy: {
      allowExternal: options.allowExternalHolderSwap ?? true,
      ...(options.expectedHolderPath === undefined
        ? {}
        : { expectedPath: options.expectedHolderPath }),
    },
  });
};

const rootBranchOf = ({ worktrees }: RepoContext): string | null =>
  worktrees.find((wt) => wt.kind === "root")?.branch ?? null;

const dirtyRootRejection = async (
  git: GitPort,
  context: RepoContext,
): Promise<CommandResult<RootData> | null> => {
  const dirty = await isWorktreeDirty(git, context.worktrees, context.rootPath);
  if (!dirty) {
    return null;
  }
  return fail(
    EXIT_SAFE_REJECTION,
    "Root clone has uncommitted or untracked changes. Commit, stash, or discard them before switching.",
  );
};

interface RollbackState {
  readonly rootPath: string;
  readonly previousBranch: string | null;
  readonly detachedHolder: DetachedHolder | null;
}

/*
 * Best-effort rollback: try to restore the branch root was on before the
 * switch, in case the switch partially applied (e.g. created a new local
 * branch via -c and then failed setting it up). A rollback failure here does
 * not change the exit code (the original failure is still what's reported)
 * but is surfaced as a warning — otherwise root or holder could be left in
 * detached HEAD with no way for the caller to know.
 */
const rollBackSwitch = async (
  git: GitPort,
  { rootPath, previousBranch, detachedHolder }: RollbackState,
): Promise<string[]> => {
  const warnings: string[] = [];
  if (previousBranch !== null) {
    try {
      await git.switchBranch(rootPath, previousBranch, {});
    } catch {
      /*
       * Unlike the holder below, root was never detached by this command —
       * it's just still sitting on whatever branch the failed switch left it
       * on, so "detached HEAD" would be a misleading claim here.
       */
      warnings.push(`Could not restore ${rootPath} to its original branch (${previousBranch})`);
    }
  }
  /*
   * Same best-effort rollback for a holder we detached: if the root switch
   * failed after we freed up the branch, put the holder back exactly where
   * it was rather than leaving it stranded in detached HEAD for no reason.
   */
  if (detachedHolder !== null) {
    try {
      await git.switchBranch(detachedHolder.path, detachedHolder.branch, {});
    } catch {
      warnings.push(
        `Could not restore ${detachedHolder.path} to its original branch (${detachedHolder.branch}); it remains in detached HEAD`,
      );
    }
  }
  return warnings;
};

interface SwitchAndReportOptions {
  readonly git: GitPort;
  readonly fs: FsPort;
  readonly context: RepoContext;
  readonly target: string;
  readonly switchOptions: SwitchBranchOptions;
  readonly holderPolicy: HolderSwapPolicy;
}

const switchAndReport = ({
  git,
  fs,
  context,
  target,
  switchOptions,
  holderPolicy,
}: SwitchAndReportOptions): Promise<CommandResult<RootData>> =>
  withRepoLock<RootData>(context.commonDir, async () => {
    // Set only if this run detaches a holder's HEAD, so a failed root switch
    // Can roll the holder back to the branch it actually had checked out.
    let detachedHolder: DetachedHolder | null = null;
    // The branch to roll root back to if the switch below fails. Read from
    // The lock-guarded `fresh` context (not the pre-lock `context`), so a
    // Branch change by another process while we waited for the lock doesn't
    // Send us rolling back to a stale branch.
    let previousBranch: string | null = null;
    try {
      // Re-validate under lock: root may have gone dirty, or another process
      // May have started checking out the target branch, since the checks above.
      const fresh = await loadRepoContext(git, fs, context.rootPath);
      previousBranch = rootBranchOf(fresh);
      const stillDirty = await dirtyRootRejection(git, fresh);
      if (stillDirty !== null) {
        return stillDirty;
      }

      const holderSwap = await resolveHolderSwap({
        git,
        fresh,
        target,
        switchOptions,
        policy: holderPolicy,
      });
      if ("rejection" in holderSwap) {
        return holderSwap.rejection;
      }
      ({ detachedHolder } = holderSwap);

      await git.switchBranch(fresh.rootPath, target, switchOptions);
      // For target === "-", git resolves the destination itself (@{-1}), so we
      // Don't know the branch name up front — read it back from the worktree
      // List rather than guessing.
      let resolvedBranch: string | null = target;
      if (target === "-") {
        const afterSwitch = await loadRepoContext(git, fs, fresh.rootPath);
        resolvedBranch = rootBranchOf(afterSwitch);
      }
      return ok({
        path: fresh.rootPath,
        data: {
          branch: resolvedBranch,
          switched: true,
          detachedHolder: detachedHolder?.path ?? null,
        },
        warnings: detachedHolder === null ? [] : [`Put ${detachedHolder.path} into detached HEAD`],
      });
    } catch (error) {
      const warnings = await rollBackSwitch(git, {
        rootPath: context.rootPath,
        previousBranch,
        detachedHolder,
      });
      return fail(EXIT_SAFE_REJECTION, `Failed to switch root: ${messageOf(error)}`, warnings);
    }
  });

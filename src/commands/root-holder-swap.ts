import type { GitPort, SwitchBranchOptions } from "../domain/ports.ts";
import { type CommandResult, EXIT_SAFE_REJECTION, fail } from "../domain/result.ts";
import type { RootData } from "../domain/schema.ts";
import { isWorktreeDirty, type RepoContext } from "../infra/repo.ts";

/**
 * The holder swap behind `hop root <branch>`: resolves which other worktree
 * holds the target branch and detaches it when that is safe.
 */

export interface DetachedHolder {
  readonly path: string;
  readonly branch: string;
}

export interface HolderSwapPolicy {
  readonly allowExternal: boolean;
  readonly expectedPath?: string;
}

const holderRejection = (
  branch: string,
  holderPath: string,
  reason: string,
): CommandResult<RootData> =>
  fail(
    EXIT_SAFE_REJECTION,
    `Branch "${branch}" is already checked out at ${holderPath}, and it ${reason}. Not swapping — cd there instead of using hop root.`,
  );

/**
 * A holder git reports prunable (its directory or its .git file is gone) can be
 * neither inspected nor detached, and git refuses to switch to its branch
 * anyway, so this only swaps an opaque spawn error for the way out. Not
 * `holderRejection`: there is nowhere to cd.
 */
const prunableHolderRejection = (branch: string, holderPath: string): CommandResult<RootData> =>
  fail(
    EXIT_SAFE_REJECTION,
    `Branch "${branch}" is held by a stale worktree registration at ${holderPath} (git reports it prunable). Not swapping — drop that registration first ("hop rm ${branch}", or "git worktree prune").`,
  );

/**
 * Rejects when more than one other worktree has `target` checked out (e.g.
 * `git worktree add --force` lets git create a second worktree on the same
 * branch). Detaching one of several holders would still leave the branch
 * checked out on the other(s), so root's switch would fail anyway after
 * detaching the first — this checks *before* detaching anything, so no
 * holder is left stranded in detached HEAD for a swap that could never
 * have succeeded.
 */
const multipleHoldersRejection = (
  branch: string,
  holders: readonly { readonly path: string }[],
): CommandResult<RootData> =>
  fail(
    EXIT_SAFE_REJECTION,
    `Branch "${branch}" is checked out at ${holders.length} worktrees at once (${holders.map((holder) => holder.path).join(", ")}). Not swapping — hop won't guess which one to detach.`,
  );

export type HolderSwapResult =
  | { readonly rejection: CommandResult<RootData> }
  | { readonly detachedHolder: DetachedHolder | null };

interface ResolveHolderSwapOptions {
  readonly git: GitPort;
  readonly fresh: RepoContext;
  readonly target: string;
  readonly switchOptions: SwitchBranchOptions;
  readonly policy: HolderSwapPolicy;
}

/**
 * Resolves the holder situation for `target` (any other worktree that
 * already has it checked out) before root's own switch runs: rejects on
 * multiple holders or an unswappable single holder, detaches a swappable
 * single holder and reports it, or reports no holder at all.
 */
export const resolveHolderSwap = async ({
  git,
  fresh,
  target,
  switchOptions,
  policy,
}: ResolveHolderSwapOptions): Promise<HolderSwapResult> => {
  if (target === "-") {
    return { detachedHolder: null };
  }

  const freshHolders = fresh.worktrees.filter((wt) => wt.branch === target && wt.kind !== "root");
  if (freshHolders.length > 1) {
    // More than one other worktree already has `target` checked out (e.g.
    // `Git worktree add --force`) — checked before detaching anything,
    // Since detaching just one holder still leaves the branch checked out
    // On the rest.
    return { rejection: multipleHoldersRejection(target, freshHolders) };
  }
  const [freshHolder] = freshHolders;
  if (freshHolder === undefined) {
    return { detachedHolder: null };
  }

  if (policy.expectedPath !== undefined && freshHolder.path !== policy.expectedPath) {
    return {
      rejection: holderRejection(
        target,
        freshHolder.path,
        `changed from the picker selection at ${policy.expectedPath}`,
      ),
    };
  }
  if (freshHolder.kind === "external" && !policy.allowExternal) {
    return {
      rejection: holderRejection(
        target,
        freshHolder.path,
        "is external and requires confirmation before it can be put into detached HEAD",
      ),
    };
  }

  if (switchOptions.createBranch === true) {
    // Hop's local-branch check (`git for-each-ref refs/heads/`) found no
    // Branch named `target`, but a worktree checked out on it exists
    // Anyway — most commonly an unborn-HEAD worktree (`git worktree add
    // --orphan`), whose branch has no commits yet and so never appears in
    // Refs/heads/; less commonly, another process created and checked it
    // Out between hop's initial (pre-lock) check and now. Either way, hop
    // Was about to `-c` a branch that already exists there — refuse rather
    // Than guess at which case this is.
    return {
      rejection: holderRejection(
        target,
        freshHolder.path,
        "wasn't visible when hop checked existing local branches (e.g. it has no commits yet, or was created after that check)",
      ),
    };
  }
  if (freshHolder.locked) {
    return {
      rejection: holderRejection(
        target,
        freshHolder.path,
        `is locked by git${freshHolder.lockReason === null ? "" : ` (${freshHolder.lockReason})`}`,
      ),
    };
  }
  if (freshHolder.prunable) {
    return { rejection: prunableHolderRejection(target, freshHolder.path) };
  }
  const holderDirty = await isWorktreeDirty(git, fresh.worktrees, freshHolder.path);
  if (holderDirty) {
    return {
      rejection: holderRejection(target, freshHolder.path, "has uncommitted or untracked changes"),
    };
  }

  await git.detachHead(freshHolder.path);
  return { detachedHolder: { path: freshHolder.path, branch: target } };
};

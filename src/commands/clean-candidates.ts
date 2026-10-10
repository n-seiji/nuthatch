import { classifyGarbage, type GarbageInput } from "../domain/garbage.ts";
import type { FsPort, GitPort } from "../domain/ports.ts";
import type { CleanCandidate, GarbageReason, Worktree } from "../domain/schema.ts";
import { type RepoContext, worktreeDirtyState } from "../infra/repo.ts";

/** Finds worktrees safe for `hop clean` to remove (see clean.ts for the policy). */
export const buildCleanCandidates = async (
  git: GitPort,
  fs: FsPort,
  context: RepoContext,
  ext: boolean,
): Promise<CleanCandidate[]> => {
  const defaultRef = await git.resolveDefaultBranchRef(context.rootPath);

  const targets = context.worktrees.filter(
    (wt) => wt.kind === "managed" || (ext && wt.kind === "external"),
  );

  const results = await Promise.all(
    targets.map(async (wt): Promise<CleanCandidate | null> => {
      const reason = await classifyCleanReason(wt, { git, fs, defaultRef, context });
      if (reason === null) {
        return null;
      }
      return { branch: wt.branch ?? "", path: wt.path, reason };
    }),
  );

  return results.filter((candidate): candidate is CleanCandidate => candidate !== null);
};

export interface ClassifyWorktreeContext {
  readonly git: GitPort;
  readonly fs: FsPort;
  readonly defaultRef: string | null;
  readonly context: RepoContext;
}

/**
 * The reason `hop clean` would remove `wt` (null: it would not), whatever
 * its kind — callers decide which kinds are eligible. `defaultRef` comes
 * from `git.resolveDefaultBranchRef`.
 */
export const classifyCleanReason = async (
  wt: Worktree,
  { git, fs, defaultRef, context }: ClassifyWorktreeContext,
): Promise<GarbageReason | null> => {
  if (wt.prunable) {
    return classifyGarbage({
      prunable: true,
      clean: false,
      mergedIntoDefault: "unknown",
      upstreamGone: false,
      allCommitsReachableFromDefault: "unknown",
    });
  }

  // Everything else requires a branch to check merge/upstream status against.
  if (wt.branch === null) {
    return null;
  }

  const { rootPath, worktrees } = context;
  const [dirtyState, upstreamGone] = await Promise.all([
    worktreeDirtyState(git, fs, worktrees, wt),
    git.isUpstreamGone(rootPath, wt.branch),
  ]);

  const mergedIntoDefault =
    defaultRef === null ? "unknown" : await git.isAncestor(rootPath, wt.branch, defaultRef);
  // "gone" also needs to recognize squash/rebase merges, whose commits are
  // Never literal ancestors of the branch they were merged into.
  const allCommitsReachableFromDefault =
    defaultRef === null
      ? "unknown"
      : await git.hasEquivalentCommits(rootPath, wt.branch, defaultRef);

  const input: GarbageInput = {
    prunable: false,
    clean: dirtyState === false,
    mergedIntoDefault,
    upstreamGone,
    allCommitsReachableFromDefault,
  };
  return classifyGarbage(input);
};

import { classifyGarbage, type GarbageInput } from "../domain/garbage.ts";
import type { GitPort } from "../domain/ports.ts";
import type { CleanCandidate, Worktree } from "../domain/schema.ts";
import { otherWorktreePaths, type RepoContext } from "../infra/repo.ts";

/** Finds worktrees safe for `hop clean` to remove (see clean.ts for the policy). */
export const buildCleanCandidates = async (
  git: GitPort,
  context: RepoContext,
  ext: boolean,
): Promise<CleanCandidate[]> => {
  const defaultRef = await git.resolveDefaultBranchRef(context.rootPath);

  const targets = context.worktrees.filter(
    (wt) => wt.kind === "managed" || (ext && wt.kind === "external"),
  );

  const results = await Promise.all(
    targets.map(async (wt): Promise<CleanCandidate | null> => {
      const reason = await classifyWorktree(wt, { git, defaultRef, context });
      if (reason === null) {
        return null;
      }
      return { branch: wt.branch ?? "", path: wt.path, reason };
    }),
  );

  return results.filter((candidate): candidate is CleanCandidate => candidate !== null);
};

interface ClassifyWorktreeContext {
  readonly git: GitPort;
  readonly defaultRef: string | null;
  readonly context: RepoContext;
}

const classifyWorktree = async (
  wt: Worktree,
  { git, defaultRef, context }: ClassifyWorktreeContext,
) => {
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
  const [isClean, upstreamGone] = await Promise.all([
    wt.bare
      ? Promise.resolve(false)
      : (async () => !(await git.isDirty(wt.path, otherWorktreePaths(worktrees, wt.path))))(),
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
    clean: isClean,
    mergedIntoDefault,
    upstreamGone,
    allCommitsReachableFromDefault,
  };
  return classifyGarbage(input);
};

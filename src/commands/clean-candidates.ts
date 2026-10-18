import { classifyGarbage, type GarbageInput } from "../domain/garbage.ts";
import type { FsPort, GitPort } from "../domain/ports.ts";
import type { CleanCandidate, Worktree } from "../domain/schema.ts";
import { type UpstreamState, upstreamStateOf } from "../domain/upstream.ts";
import { type RepoContext, worktreeDirtyState } from "../infra/repo.ts";

/** Finds worktrees safe for `hop clean` to remove (see clean.ts for the policy). */
export const buildCleanCandidates = async (
  git: GitPort,
  fs: FsPort,
  context: RepoContext,
  ext: boolean,
): Promise<CleanCandidate[]> => {
  const [defaultRef, upstreams] = await Promise.all([
    git.resolveDefaultBranchRef(context.rootPath),
    git.upstreamStates(context.rootPath),
  ]);

  const targets = context.worktrees.filter(
    (wt) => wt.kind === "managed" || (ext && wt.kind === "external"),
  );

  const results = await Promise.all(
    targets.map(async (wt): Promise<CleanCandidate | null> => {
      const reason = await classifyWorktree(wt, { git, fs, defaultRef, upstreams, context });
      if (reason === null) {
        return null;
      }
      return { branch: wt.branch ?? "", path: wt.path, reason };
    }),
  );

  return results.filter((candidate): candidate is CleanCandidate => candidate !== null);
};

export interface BranchPolicyFacts {
  readonly defaultRef: string | null;
  readonly upstreams: ReadonlyMap<string, UpstreamState>;
}

export const branchMergeFacts = async (
  git: GitPort,
  rootPath: string,
  branch: string,
  { defaultRef, upstreams }: BranchPolicyFacts,
): Promise<Omit<GarbageInput, "clean">> => {
  const upstreamGone = upstreamStateOf(upstreams, branch).kind === "gone";
  const mergedIntoDefault =
    defaultRef === null ? "unknown" : await git.isAncestor(rootPath, branch, defaultRef);
  // "gone" also needs to recognize squash/rebase merges, whose commits are
  // Never literal ancestors of the branch they were merged into. The answer
  // Only matters for a gone upstream on a branch that isn't merged outright.
  const allCommitsReachableFromDefault =
    defaultRef === null || mergedIntoDefault === true || !upstreamGone
      ? "unknown"
      : await git.hasEquivalentCommits(rootPath, branch, defaultRef);
  return {
    prunable: false,
    upstreamGone,
    mergedIntoDefault,
    allCommitsReachableFromDefault,
  };
};

interface ClassifyWorktreeContext {
  readonly git: GitPort;
  readonly fs: FsPort;
  readonly defaultRef: string | null;
  readonly upstreams: ReadonlyMap<string, UpstreamState>;
  readonly context: RepoContext;
}

const classifyWorktree = async (
  wt: Worktree,
  { git, fs, defaultRef, upstreams, context }: ClassifyWorktreeContext,
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
  const facts = await branchMergeFacts(git, rootPath, wt.branch, { defaultRef, upstreams });
  // A dirty worktree is never a candidate, so when the branch facts already
  // Rule this one out, skip the status scan: it is by far the most expensive
  // Check, and most worktrees in use are neither merged nor gone.
  if (classifyGarbage({ ...facts, clean: true }) === null) {
    return null;
  }
  const dirtyState = await worktreeDirtyState(git, fs, worktrees, wt);
  const input: GarbageInput = { ...facts, clean: dirtyState === false };
  return classifyGarbage(input);
};

import { classifyGarbage, type GarbageInput } from "../domain/garbage.ts";
import type { FsPort, GitPort, TermPort } from "../domain/ports.ts";
import { type CommandResult, EXIT_USAGE_ERROR, fail, ok } from "../domain/result.ts";
import type { CleanCandidate, CleanData, Worktree } from "../domain/schema.ts";
import { acquireRepoLock } from "../infra/lock.ts";
import { loadRepoContext, type RepoContext } from "../infra/repo.ts";

export type { CleanCandidate, CleanData } from "../domain/schema.ts";

export interface CleanOptions {
  readonly cwd: string;
  /** Also consider external (non-nuthatch-managed) worktrees. */
  readonly ext: boolean;
  /** Delete the branch too, in addition to the worktree. */
  readonly withBranch: boolean;
  /** Only report candidates; never remove anything. */
  readonly dryRun: boolean;
  /** Skip interactive confirmation and execute immediately. */
  readonly yes: boolean;
}

/**
 * `hop clean` — finds worktrees that are safe to remove (prunable, merged
 * into the default branch, or whose upstream is gone) and, unless
 * `--dry-run`, removes them. Candidates are always computed first; execution
 * only proceeds when the caller has already confirmed (`--yes`) — this
 * command never prompts itself (see cli.ts, which owns TTY interaction).
 */
export const clean = async (
  git: GitPort,
  fs: FsPort,
  term: TermPort,
  options: CleanOptions,
): Promise<CommandResult<CleanData>> => {
  const context = await loadRepoContext(git, fs, options.cwd);
  const candidates = await buildCleanCandidates(git, context, options.ext);

  if (options.dryRun) {
    return ok({ data: { candidates } });
  }

  if (candidates.length === 0) {
    return ok({ data: { candidates, removed: [] } });
  }

  if (!options.yes) {
    if (!term.isTTY()) {
      return fail(
        EXIT_USAGE_ERROR,
        "hop clean would remove worktrees; re-run with --yes (non-interactive) or --dry-run to only list candidates.",
      );
    }
    for (const candidate of candidates) {
      term.logStderr(`${candidate.reason}\t${candidate.branch}\t${candidate.path}`);
    }
    const confirmed = await term.confirm(`Remove ${candidates.length} worktree(s) above?`);
    if (!confirmed) {
      return ok({ data: { candidates, removed: [] } });
    }
  }

  const execution = await executeClean({
    git,
    fs,
    context,
    candidates,
    cleanOptions: options,
  });
  return ok({
    data: { candidates, removed: execution.removed },
    ...(execution.warnings.length === 0 ? {} : { warnings: execution.warnings }),
  });
};

const buildCleanCandidates = async (
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
      const reason = await classifyWorktree(git, context.rootPath, wt, defaultRef);
      if (reason === null) {
        return null;
      }
      return { branch: wt.branch ?? "", path: wt.path, reason };
    }),
  );

  return results.filter((candidate): candidate is CleanCandidate => candidate !== null);
};

const classifyWorktree = async (
  git: GitPort,
  rootPath: string,
  wt: Worktree,
  defaultRef: string | null,
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

  const [isClean, upstreamGone] = await Promise.all([
    wt.bare ? Promise.resolve(false) : (async () => !(await git.isDirty(wt.path)))(),
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

interface ExecuteCleanOptions {
  readonly git: GitPort;
  readonly fs: FsPort;
  readonly context: RepoContext;
  readonly candidates: readonly CleanCandidate[];
  readonly cleanOptions: CleanOptions;
}

/** Removes each still-valid candidate, skipping (not failing) any that fail individually. */
const removeCandidate = async (
  git: GitPort,
  rootPath: string,
  candidate: CleanCandidate,
  deleteBranch: boolean,
): Promise<boolean> => {
  try {
    await git.removeWorktree(rootPath, candidate.path, false);
    if (deleteBranch && candidate.branch.length > 0) {
      await git.deleteBranch(rootPath, candidate.branch);
    }
    return true;
  } catch {
    // Best-effort: skip candidates that fail to remove (e.g. raced away).
    // A partial clean is still useful, and the safety checks above already
    // Ensure nothing unreviewed is touched.
    return false;
  }
};

const canDeletePrunableBranch = async (
  git: GitPort,
  rootPath: string,
  candidate: CleanCandidate,
  defaultRef: string | null,
): Promise<boolean> => {
  if (candidate.reason !== "prunable") {
    return true;
  }
  if (candidate.branch.length === 0 || defaultRef === null) {
    return false;
  }

  try {
    const mergedIntoDefault = await git.isAncestor(rootPath, candidate.branch, defaultRef);
    if (mergedIntoDefault === true) {
      return true;
    }
    if (await git.isUpstreamGone(rootPath, candidate.branch)) {
      return (await git.hasEquivalentCommits(rootPath, candidate.branch, defaultRef)) === true;
    }
  } catch {
    // An indeterminate safety check must keep the branch.
  }
  return false;
};

interface CleanExecution {
  readonly removed: string[];
  readonly warnings: string[];
}

const executeClean = async ({
  git,
  fs,
  context,
  candidates,
  cleanOptions,
}: ExecuteCleanOptions): Promise<CleanExecution> => {
  const lock = await acquireRepoLock(context.commonDir);
  try {
    // Re-validate under lock: a candidate may have gone dirty, or lost its
    // Garbage status, since it was computed above.
    const fresh = await loadRepoContext(git, fs, context.rootPath);
    const freshCandidates = await buildCleanCandidates(git, fresh, cleanOptions.ext);
    const freshByPath = new Map(freshCandidates.map((candidate) => [candidate.path, candidate]));
    const stillValid = candidates.flatMap((candidate) => {
      const freshCandidate = freshByPath.get(candidate.path);
      return freshCandidate === undefined ? [] : [freshCandidate];
    });
    const defaultRef = await git.resolveDefaultBranchRef(fresh.rootPath);

    const removed: string[] = [];
    const warnings: string[] = [];
    for (const candidate of stillValid) {
      // A prunable worktree has no directory to inspect, so prunable alone
      // Does not establish that its branch is safe to delete.
      // oxlint-disable-next-line no-await-in-loop
      const branchSafe = await canDeletePrunableBranch(git, fresh.rootPath, candidate, defaultRef);
      const deleteBranch = cleanOptions.withBranch && branchSafe;
      if (
        cleanOptions.withBranch &&
        candidate.reason === "prunable" &&
        candidate.branch.length > 0 &&
        !branchSafe
      ) {
        warnings.push(
          `Keeping branch "${candidate.branch}": prunable worktree is not confirmed merged or gone.`,
        );
      }
      // oxlint-disable-next-line no-await-in-loop
      const success = await removeCandidate(git, fresh.rootPath, candidate, deleteBranch);
      if (success) {
        removed.push(candidate.branch);
      }
    }
    return { removed, warnings };
  } catch (error) {
    throw new Error(`Failed to clean worktrees: ${(error as Error).message}`, {
      cause: error,
    });
  } finally {
    await lock.release();
  }
};

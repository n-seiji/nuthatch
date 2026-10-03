import { messageOf } from "../domain/fatal-error.ts";
import type { Worktree } from "../domain/model.ts";
import type { FsPort, GitPort, TermPort } from "../domain/ports.ts";
import { type CommandResult, EXIT_USAGE_ERROR, fail, ok } from "../domain/result.ts";
import type { CleanCandidate, CleanData } from "../domain/schema.ts";
import { withRepoLock } from "../infra/lock.ts";
import { loadRepoContext, nestedWorktrees, type RepoContext } from "../infra/repo.ts";
import { buildCleanCandidates } from "./clean-candidates.ts";

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
 * only proceeds once removal is confirmed — by `--yes`, or by the user at the
 * y/N prompt (`term.confirm`) when running on a TTY. With neither, it refuses
 * with a usage error instead of removing anything.
 */
export const clean = async (
  git: GitPort,
  fs: FsPort,
  term: TermPort,
  options: CleanOptions,
): Promise<CommandResult<CleanData>> => {
  const context = await loadRepoContext(git, fs, options.cwd);
  const candidates = await buildCleanCandidates(git, fs, context, options.ext);

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

  return executeClean({
    git,
    fs,
    context,
    candidates,
    cleanOptions: options,
  });
};

interface ExecuteCleanOptions {
  readonly git: GitPort;
  readonly fs: FsPort;
  readonly context: RepoContext;
  readonly candidates: CleanCandidate[];
  readonly cleanOptions: CleanOptions;
}

interface RemoveCandidateOptions {
  readonly git: GitPort;
  readonly rootPath: string;
  readonly candidate: CleanCandidate;
  readonly deleteBranch: boolean;
  readonly worktrees: readonly Worktree[];
}

type RemoveOutcome = "removed" | "nested" | "failed";

const removeCandidate = async ({
  git,
  rootPath,
  candidate,
  deleteBranch,
  worktrees,
}: RemoveCandidateOptions): Promise<RemoveOutcome> => {
  if (nestedWorktrees(worktrees, candidate.path).length > 0) {
    return "nested";
  }
  try {
    await git.removeWorktree(rootPath, candidate.path, false);
    if (deleteBranch && candidate.branch.length > 0) {
      await git.deleteBranch(rootPath, candidate.branch);
    }
    return "removed";
  } catch {
    // Best-effort: skip candidates that fail to remove (e.g. raced away).
    // A partial clean is still useful, and the safety checks above already
    // Ensure nothing unreviewed is touched.
    return "failed";
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

/**
 * Removes each still-valid candidate, skipping (not failing) any that fail
 * individually. Also skips (rather than removing) any candidate that still
 * contains a registered worktree — same rule as commands/rm.ts's
 * nestedWorktreeRejection: removing it would destroy the inner worktree's
 * files too, so `hop clean`'s automatic deletion must refuse it just as
 * `hop rm` would, --force-equivalent or not.
 */
const executeClean = ({
  git,
  fs,
  context,
  candidates,
  cleanOptions,
}: ExecuteCleanOptions): Promise<CommandResult<CleanData>> =>
  withRepoLock<CleanData>(context.commonDir, async () => {
    try {
      // Re-validate under lock: a candidate may have gone dirty, or lost its
      // Garbage status, since it was computed above.
      const fresh = await loadRepoContext(git, fs, context.rootPath);
      const freshCandidates = await buildCleanCandidates(git, fs, fresh, cleanOptions.ext);
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
        const branchSafe = await canDeletePrunableBranch(
          git,
          fresh.rootPath,
          candidate,
          defaultRef,
        );
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
        const outcome = await removeCandidate({
          git,
          rootPath: fresh.rootPath,
          candidate,
          deleteBranch,
          worktrees: fresh.worktrees,
        });
        if (outcome === "removed") {
          removed.push(candidate.branch);
        } else if (outcome === "nested") {
          warnings.push(`Skipped ${candidate.path}: still contains a registered worktree.`);
        }
      }
      return ok({
        data: { candidates, removed },
        ...(warnings.length === 0 ? {} : { warnings }),
      });
    } catch (error) {
      throw new Error(`Failed to clean worktrees: ${messageOf(error)}`, {
        cause: error,
      });
    }
  });

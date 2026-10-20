import { describeFatalError, messageOf } from "../domain/fatal-error.ts";
import { classifyGarbage } from "../domain/garbage.ts";
import type { CleanCandidate, CleanData, Worktree } from "../domain/schema.ts";
import type { FsPort, GitPort, TermPort } from "../domain/ports.ts";
import { type CommandResult, EXIT_USAGE_ERROR, fail, ok } from "../domain/result.ts";
import { withRepoLock } from "../infra/lock.ts";
import { loadRepoContext, nestedWorktrees, type RepoContext } from "../infra/repo.ts";
import {
  type BranchPolicyFacts,
  branchMergeFacts,
  buildCleanCandidates,
} from "./clean-candidates.ts";

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
 * y/N prompt (`term.confirm`) when running on a TTY. Without `--yes` and
 * without a TTY it refuses with a usage error; a declined prompt removes
 * nothing and still succeeds (exit 0).
 */
export const clean = async (
  git: GitPort,
  fs: FsPort,
  term: TermPort,
  options: CleanOptions,
): Promise<CommandResult<CleanData>> => {
  const context = await loadRepoContext(git, fs, options.cwd);
  const { removable: candidates, lockedWarnings } = withoutLocked(
    await buildCleanCandidates(git, fs, context, options.ext),
    context.worktrees,
  );
  const warningsField = lockedWarnings.length === 0 ? {} : { warnings: lockedWarnings };

  if (options.dryRun) {
    return ok({ data: { candidates }, ...warningsField });
  }

  if (candidates.length === 0) {
    return ok({ data: { candidates, removed: [] }, ...warningsField });
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
      return ok({ data: { candidates, removed: [] }, ...warningsField });
    }
  }

  return executeClean({
    git,
    fs,
    context,
    candidates,
    cleanOptions: options,
    initialWarnings: lockedWarnings,
  });
};

const lockedWarning = (wt: Worktree): string =>
  `Skipped ${wt.path}: locked by git${wt.lockReason === null ? "" : ` (${wt.lockReason})`}. hop never unlocks worktrees automatically — run "git worktree unlock" yourself first if you're sure.`;

/**
 * Drops candidates git reports as locked: hop never removes a locked
 * worktree, so offering one would only end in a silent no-op. Each one
 * dropped is reported as a warning instead.
 */
const withoutLocked = (
  candidates: readonly CleanCandidate[],
  worktrees: readonly Worktree[],
): { removable: CleanCandidate[]; lockedWarnings: string[] } => {
  const byPath = new Map(worktrees.map((wt) => [wt.path, wt]));
  const removable: CleanCandidate[] = [];
  const lockedWarnings: string[] = [];
  for (const candidate of candidates) {
    const wt = byPath.get(candidate.path);
    if (wt?.locked === true) {
      lockedWarnings.push(lockedWarning(wt));
    } else {
      removable.push(candidate);
    }
  }
  return { removable, lockedWarnings };
};

interface ExecuteCleanOptions {
  readonly git: GitPort;
  readonly fs: FsPort;
  readonly context: RepoContext;
  readonly candidates: readonly CleanCandidate[];
  readonly cleanOptions: CleanOptions;
  /** Warnings already collected before execution (e.g. locked candidates dropped). */
  readonly initialWarnings: readonly string[];
}

interface RemoveCandidateOptions {
  readonly git: GitPort;
  readonly rootPath: string;
  readonly candidate: CleanCandidate;
  readonly deleteBranch: boolean;
  readonly worktrees: readonly Worktree[];
}

type RemoveOutcome =
  | { readonly kind: "removed"; readonly warning?: string }
  | { readonly kind: "skipped"; readonly warning: string };

const removeCandidate = async ({
  git,
  rootPath,
  candidate,
  deleteBranch,
  worktrees,
}: RemoveCandidateOptions): Promise<RemoveOutcome> => {
  if (nestedWorktrees(worktrees, candidate.path).length > 0) {
    return {
      kind: "skipped",
      warning: `Skipped ${candidate.path}: still contains a registered worktree.`,
    };
  }
  const wt = worktrees.find((entry) => entry.path === candidate.path);
  if (wt?.locked === true) {
    return { kind: "skipped", warning: lockedWarning(wt) };
  }
  try {
    await git.removeWorktree(rootPath, candidate.path, false);
  } catch (error) {
    // Best-effort: a partial clean is still useful, so one failure doesn't
    // Stop the rest — but it is always reported, with git's own reason.
    return {
      kind: "skipped",
      warning: `Failed to remove ${candidate.path}: ${describeFatalError(error).message}`,
    };
  }
  if (deleteBranch && candidate.branch.length > 0) {
    try {
      await git.deleteBranch(rootPath, candidate.branch);
    } catch (error) {
      return {
        kind: "removed",
        warning: `Removed ${candidate.path} but kept branch "${candidate.branch}": ${describeFatalError(error).message}`,
      };
    }
  }
  return { kind: "removed" };
};

const canDeletePrunableBranch = async (
  git: GitPort,
  rootPath: string,
  candidate: CleanCandidate,
  facts: BranchPolicyFacts,
): Promise<boolean> => {
  if (candidate.reason !== "prunable") {
    return true;
  }
  if (candidate.branch.length === 0) {
    return false;
  }

  try {
    const branchFacts = await branchMergeFacts(git, rootPath, candidate.branch, facts);
    // Same verdict that makes a live candidate's branch deletable: merged or gone.
    return classifyGarbage({ ...branchFacts, clean: true }) !== null;
  } catch {
    // An indeterminate safety check must keep the branch.
    return false;
  }
};

/**
 * Removes each still-valid candidate, skipping (not failing) any that fail
 * individually — every skip, whether it dropped out on re-validation, is
 * locked, or git refused it, is reported as a warning naming the path, so
 * `removed` never silently comes back shorter than what was confirmed. Also skips (rather than removing) any candidate that still
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
  initialWarnings,
}: ExecuteCleanOptions): Promise<CommandResult<CleanData>> =>
  withRepoLock<CleanData>(context.commonDir, async () => {
    try {
      // Re-validate under lock: a candidate may have gone dirty, or lost its
      // Garbage status, since it was computed above.
      const fresh = await loadRepoContext(git, fs, context.rootPath);
      const freshCandidates = await buildCleanCandidates(git, fs, fresh, cleanOptions.ext);
      const freshByPath = new Map(freshCandidates.map((candidate) => [candidate.path, candidate]));
      const warnings: string[] = [...initialWarnings];
      const stillValid = candidates.flatMap((candidate) => {
        const freshCandidate = freshByPath.get(candidate.path);
        if (freshCandidate === undefined) {
          warnings.push(`Skipped ${candidate.path}: no longer a clean-up candidate.`);
          return [];
        }
        return [freshCandidate];
      });
      const [defaultRef, upstreams] = await Promise.all([
        git.resolveDefaultBranchRef(fresh.rootPath),
        git.upstreamStates(fresh.rootPath),
      ]);

      const removed: string[] = [];
      for (const candidate of stillValid) {
        // A prunable worktree has no directory to inspect, so prunable alone
        // Does not establish that its branch is safe to delete.
        // oxlint-disable-next-line no-await-in-loop
        const branchSafe = await canDeletePrunableBranch(git, fresh.rootPath, candidate, {
          defaultRef,
          upstreams,
        });
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
        if (outcome.kind === "removed") {
          removed.push(candidate.branch);
        }
        if (outcome.warning !== undefined) {
          warnings.push(outcome.warning);
        }
      }
      return ok({
        data: { candidates: [...candidates], removed },
        ...(warnings.length === 0 ? {} : { warnings }),
      });
    } catch (error) {
      throw new Error(`Failed to clean worktrees: ${messageOf(error)}`, {
        cause: error,
      });
    }
  });

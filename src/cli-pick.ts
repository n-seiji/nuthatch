import { pick, type PickCandidate } from "./commands/pick.ts";
import { rm } from "./commands/rm.ts";
import { root } from "./commands/root.ts";
import { candidateBranchName } from "./domain/candidates.ts";
import type { FsPort, GitPort } from "./domain/ports.ts";
import { ok } from "./domain/result.ts";
import { render } from "./render.ts";
import {
  runPicker,
  type ActionOutcome,
  type PickerCallbacks,
  type PickerResult,
} from "./ui/picker.ts";

/**
 * Loads the fresh candidate list for the picker (used both for the initial
 * render and to reload after an in-picker delete). Returns null on failure,
 * having already rendered/exit-coded the error via `render`.
 */
export const loadPickCandidates = async (
  git: GitPort,
  fs: FsPort,
  json: boolean,
): Promise<readonly PickCandidate[] | null> => {
  const pickResult = await pick(git, fs, { cwd: process.cwd() });
  if (!pickResult.ok) {
    render("pick", pickResult, json);
    process.exitCode = pickResult.exitCode;
    return null;
  }
  return pickResult.data?.candidates ?? [];
};

const deleteWorktree = async (
  git: GitPort,
  fs: FsPort,
  candidate: PickCandidate,
): Promise<ActionOutcome> => {
  const branch = candidateBranchName(candidate);
  if (branch === null) {
    return { ok: false, message: "This candidate has no branch to remove." };
  }
  const result = await rm(git, fs, {
    cwd: process.cwd(),
    branch,
    ...(candidate.kind === "worktree" ? { expectedPath: candidate.worktree.path } : {}),
    force: false,
    ext: false,
  });
  if (!result.ok) {
    return {
      ok: false,
      message: result.errorMessage ?? "Failed to remove worktree.",
    };
  }
  return { ok: true };
};

/** What a successful in-picker switchRoot produced, for renderSwitchRootOutcome afterwards. */
export interface SwitchRootOutcome {
  readonly branch: string;
  readonly detachedHolder: string | null;
  readonly warnings: readonly string[];
}

/**
 * Wires the picker's action-panel mutations (delete / switch root here) to
 * commands/rm.ts and commands/root.ts here, rather than in ui/picker.ts,
 * because ui/ must not import commands/ (see AGENTS.md's dependency
 * direction) — picker.ts only ever calls the callbacks it's handed.
 * `onSwitchedBranch` records the full outcome of a successful switchRoot
 * (branch, any detached holder, any warnings), so the caller can render its
 * `--json` output — and stderr warnings — afterwards with nothing lost.
 */
export const createPickerCallbacks = (
  git: GitPort,
  fs: FsPort,
  json: boolean,
  onSwitchedBranch: (outcome: SwitchRootOutcome) => void,
): PickerCallbacks => ({
  deleteWorktree: (candidate) => deleteWorktree(git, fs, candidate),
  switchRootHere: async (candidate) => {
    const branch = candidateBranchName(candidate);
    if (branch === null) {
      return {
        ok: false,
        message: "This candidate has no branch to switch to.",
      };
    }
    const result = await root(git, fs, {
      cwd: process.cwd(),
      target: branch,
      allowExternalHolderSwap:
        candidate.kind === "worktree" && candidate.worktree.kind === "external",
      ...(candidate.kind === "worktree" ? { expectedHolderPath: candidate.worktree.path } : {}),
    });
    if (!result.ok) {
      return {
        ok: false,
        message: result.errorMessage ?? "Failed to switch root.",
      };
    }
    onSwitchedBranch({
      branch,
      detachedHolder: result.data?.detachedHolder ?? null,
      warnings: result.warnings ?? [],
    });
    return {
      ok: true,
      ...(result.path === undefined ? {} : { path: result.path }),
    };
  },
  reloadCandidates: async () => (await loadPickCandidates(git, fs, json)) ?? [],
});

/**
 * Runs the picker. Kept as its own function (rather than calling
 * ui/picker.ts's runPicker directly from cli.ts) so cli.ts never depends on
 * ui/ at all — mirroring the rest of this module's job of being the one
 * place that wires ui/ callbacks to commands/.
 */
export const runInteractivePicker = (
  candidates: readonly PickCandidate[],
  callbacks: PickerCallbacks,
): Promise<PickerResult> => runPicker(candidates, callbacks);

/**
 * Renders a completed switchRoot outcome (Ctrl+R / panel "switch root
 * here") as the CLI's cd contract expects. Threads detachedHolder and
 * warnings all the way through — previously these were dropped here, so
 * `--json` never reported a holder that switchRootHere detached, and its
 * warning (`Put <path> into detached HEAD`) never reached stderr either,
 * unlike the non-picker `hop root <branch>` path.
 */
export const renderSwitchRootOutcome = (
  path: string,
  outcome: SwitchRootOutcome | null,
  json: boolean,
): void => {
  const branch = outcome?.branch ?? null;
  const detachedHolder = outcome?.detachedHolder ?? null;
  const warnings = outcome?.warnings ?? [];
  if (json) {
    render("root", ok({ path, data: { branch, switched: true, detachedHolder }, warnings }), true);
    return;
  }
  process.stdout.write(`${path}\n`);
  for (const warning of warnings) {
    process.stderr.write(`warning: ${warning}\n`);
  }
};

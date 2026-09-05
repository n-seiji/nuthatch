import { pick, type PickCandidate } from "./commands/pick.ts";
import { rm } from "./commands/rm.ts";
import { root } from "./commands/root.ts";
import { candidateBranchName } from "./domain/candidates.ts";
import type { FsPort, GitPort } from "./domain/ports.ts";
import { ok } from "./domain/result.ts";
import { render } from "./render.ts";
import type { ActionOutcome, PickerCallbacks, PickerResult } from "./ui/picker.tsx";

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

/**
 * Wires the picker's action-panel mutations (delete / switch root here) to
 * commands/rm.ts and commands/root.ts here, rather than in ui/picker.tsx,
 * because ui/ must not import commands/ (see AGENTS.md's dependency
 * direction) — picker.tsx only ever calls the callbacks it's handed.
 * `onSwitchedBranch` records the branch a successful switchRoot targeted,
 * so the caller can render its `--json` output afterwards.
 */
export const createPickerCallbacks = (
  git: GitPort,
  fs: FsPort,
  json: boolean,
  onSwitchedBranch: (branch: string) => void,
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
    const result = await root(git, fs, { cwd: process.cwd(), target: branch });
    if (!result.ok) {
      return {
        ok: false,
        message: result.errorMessage ?? "Failed to switch root.",
      };
    }
    onSwitchedBranch(branch);
    return {
      ok: true,
      ...(result.path === undefined ? {} : { path: result.path }),
    };
  },
  reloadCandidates: async () => (await loadPickCandidates(git, fs, json)) ?? [],
});

/**
 * Runs the picker (ink, falling back to the plain readline picker) and
 * normalizes both to PickerResult. The readline fallback can't distinguish
 * Esc from Ctrl+C (no raw-mode key events), so its cancellation always
 * reports "esc" — the quieter of the two exit codes (see runInteractivePick
 * in cli.ts). A genuine Ctrl+C there hits Node's default SIGINT handling
 * instead, which already exits 130 on its own.
 */
export const runInteractivePicker = async (
  candidates: readonly PickCandidate[],
  callbacks: PickerCallbacks,
): Promise<PickerResult> => {
  try {
    const { runPicker } = await import("./ui/picker.tsx");
    return await runPicker(candidates, callbacks);
  } catch {
    const { runSimplePicker } = await import("./ui/simple-picker.ts");
    const selected = await runSimplePicker(candidates);
    return selected === null
      ? { type: "cancelled", reason: "esc" }
      : { type: "cd", candidate: selected };
  }
};

/** Renders a completed switchRoot outcome (Ctrl+R / panel "switch root here") as the CLI's cd contract expects. */
export const renderSwitchRootOutcome = (
  path: string,
  branch: string | null,
  json: boolean,
): void => {
  if (json) {
    render("root", ok({ path, data: { branch, switched: true } }), true);
    return;
  }
  process.stdout.write(`${path}\n`);
};

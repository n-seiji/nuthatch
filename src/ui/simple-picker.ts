import { createInterface } from "node:readline";
import { candidateBranchLabel, type PickCandidate } from "../domain/candidates.ts";

/**
 * Non-interactive-terminal-safe fallback picker: a numbered list on stderr,
 * with the choice read from stdin via readline. Used when ink can't run
 * (e.g. not bundled correctly into a `bun build --compile` binary) — see
 * cli.ts's dynamic import of ui/picker.tsx for the primary picker.
 *
 * Only supports cd (no action panel — readline has no keybindings to hang
 * one off, and no raw-mode key events to distinguish Esc from Ctrl+C);
 * cli-pick.ts wraps its result to match ui/picker.tsx's PickerResult
 * contract — a selection becomes `{ type: "cd", candidate }`, empty input
 * becomes `{ type: "cancelled", reason: "esc" }`. A genuine Ctrl+C here
 * hits Node's default SIGINT handling (this runs in cooked mode) and exits
 * 130 on its own, without going through this return value at all.
 *
 * Never writes to stdout — same contract as the ink picker.
 */
export const runSimplePicker = (
  candidates: readonly PickCandidate[],
): Promise<PickCandidate | null> =>
  new Promise((resolve) => {
    if (candidates.length === 0) {
      process.stderr.write("No candidates.\n");
      resolve(null);
      return;
    }

    candidates.forEach((candidate, index) => {
      const kind =
        candidate.kind === "worktree" ? candidate.worktree.kind : `new (${candidate.source})`;
      const path = candidate.kind === "worktree" ? candidate.worktree.path : "(not created yet)";
      process.stderr.write(`${index + 1}) [${kind}] ${candidateBranchLabel(candidate)} ${path}\n`);
    });
    process.stderr.write("Select a number (empty to cancel): ");

    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
      terminal: false,
    });

    const finish = (result: PickCandidate | null): void => {
      rl.close();
      resolve(result);
    };

    rl.once("line", (line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        finish(null);
        return;
      }
      const choice = Math.trunc(Number(trimmed));
      const selected = candidates[choice - 1];
      finish(selected ?? null);
    });

    rl.once("close", () => {
      resolve(null);
    });
  });

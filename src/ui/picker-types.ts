import type { PickerActionKind } from "../domain/actions.ts";
import type { PickCandidate } from "../domain/candidates.ts";
import type { PickerCancelReason } from "./picker-keys.ts";

/** An in-picker mutation's failure, shown inline in the panel (e.g. "dirty, use rm --force"). */
interface ActionFailure {
  readonly ok: false;
  readonly message: string;
}

export type DeleteWorktreeOutcome = { readonly ok: true } | ActionFailure;

/** On success, `path` is the root clone's path, printed on exit. */
export type SwitchRootHereOutcome = { readonly ok: true; readonly path: string } | ActionFailure;

/**
 * Mutations the picker can trigger, injected by cli.ts. picker.ts (ui/)
 * must not import commands/ directly (see AGENTS.md's dependency direction),
 * so cli.ts wires these to commands/rm.ts and commands/root.ts and hands
 * them in — the picker only ever calls the callbacks it's given.
 */
export interface PickerCallbacks {
  readonly deleteWorktree: (candidate: PickCandidate) => Promise<DeleteWorktreeOutcome>;
  readonly switchRootHere: (candidate: PickCandidate) => Promise<SwitchRootHereOutcome>;
  /** Re-fetches the candidate list after a successful delete, so the picker can stay open. */
  readonly reloadCandidates: () => Promise<readonly PickCandidate[]>;
}

export type PickerOutcome =
  | { readonly type: "cd"; readonly candidate: PickCandidate }
  // Already applied (switchRoot ran via the callback) — cli.ts just prints the path and exits.
  | { readonly type: "path"; readonly path: string };

/**
 * Esc and Ctrl+C both back out of the picker without a selection, but with
 * different exit codes (see cli-pick.ts): Esc is a quiet "never mind" (exit
 * 0, empty stdout — the shell wrapper just doesn't cd), Ctrl+C reads as a
 * real interrupt (exit 130, matching a genuine SIGINT).
 */
export interface PickerCancellation {
  readonly type: "cancelled";
  readonly reason: PickerCancelReason;
}

export type PickerResult = PickerOutcome | PickerCancellation;

export type PickerMode =
  | { readonly kind: "list" }
  | {
      readonly kind: "panel";
      readonly candidate: PickCandidate;
      readonly error: string | null;
    }
  | {
      readonly kind: "confirm";
      /** Which mutation the y/N overlay is gating — currently "delete" or "switchRoot". */
      readonly action: Exclude<PickerActionKind, "cd">;
      readonly candidate: PickCandidate;
    };

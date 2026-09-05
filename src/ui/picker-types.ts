import type { PickCandidate } from "../domain/candidates.ts";
import type { PickerCancelReason } from "./picker-keys.ts";

/** Result of an in-picker mutation attempt (delete / switchRoot). */
export interface ActionOutcome {
  readonly ok: boolean;
  /** Present on switchRoot success — the root clone's path, to print on exit. */
  readonly path?: string;
  /** Present on failure — shown inline in the panel (e.g. "dirty, use rm --force"). */
  readonly message?: string;
}

/**
 * Mutations the picker can trigger, injected by cli.ts. picker.tsx (ui/)
 * must not import commands/ directly (see AGENTS.md's dependency direction),
 * so cli.ts wires these to commands/rm.ts and commands/root.ts and hands
 * them in — the picker only ever calls the callbacks it's given.
 */
export interface PickerCallbacks {
  readonly deleteWorktree: (candidate: PickCandidate) => Promise<ActionOutcome>;
  readonly switchRootHere: (candidate: PickCandidate) => Promise<ActionOutcome>;
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
      readonly kind: "confirmDelete";
      readonly candidate: PickCandidate;
      readonly error: string | null;
    };

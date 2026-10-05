import type { PickCandidate } from "../domain/candidates.ts";
import type { PickerKeyEvent } from "./picker-key-parser.ts";
import { renderPickerFrame } from "./picker-render.ts";
import { createPickerStore } from "./picker-store.ts";
import type { PickerCallbacks, PickerResult } from "./picker-types.ts";
import { DEFAULT_TERMINAL_HEIGHT } from "./picker-viewport.ts";
import { runTerminalSession } from "./terminal-session.ts";

export type {
  ActionOutcome,
  PickerCallbacks,
  PickerCancellation,
  PickerOutcome,
  PickerResult,
} from "./picker-types.ts";

const DEFAULT_TERMINAL_WIDTH = 80;

/**
 * `stream.columns`/`stream.rows` is `undefined` when the stream isn't a
 * TTY at all, but some pty implementations (notably the one this repo's own
 * integration tests drive, before any resize) report a real `0` from
 * `TIOCGWINSZ` instead -- `??`'s fallback never triggers on `0`, so a
 * literal 0 used to flow all the way into truncateLineToWidth as the
 * terminal width and collapse every line down to just an ellipsis. Treat
 * anything not strictly positive as "unknown" too.
 */
const terminalDimension = (value: number | undefined, fallback: number): number =>
  value !== undefined && value > 0 ? value : fallback;

/** Whether SGR color codes should be emitted at all — NO_COLOR (any non-empty value, per the convention) or a non-TTY stderr both disable it; a picker running under `--json`-style piping should never leak escape codes into whatever's consuming stderr. */
const colorEnabled = (stderr: NodeJS.WriteStream): boolean =>
  stderr.isTTY === true && (process.env["NO_COLOR"] ?? "") === "";

/** Ctrl+C, in any mode: raw-mode stdin never generates a real SIGINT for it (see terminal-session.ts's module comment), so it's handled here — before any mode-specific dispatch — rather than relying on picker-keys.ts's per-mode resolvers (only the list-mode one recognizes it). */
const isCtrlC = (event: PickerKeyEvent): boolean => event.key.ctrl && event.input === "c";

/**
 * Runs the picker on stderr (never stdout — stdout is reserved for the
 * final selected path, per the CLI's cd contract) and resolves with the
 * outcome: a selection/completed action, or a cancellation carrying which
 * key caused it (Esc vs. Ctrl+C — see PickerCancellation and cli-pick.ts,
 * which map these to different exit codes).
 */
export const runPicker = (
  candidates: readonly PickCandidate[],
  callbacks: PickerCallbacks,
): Promise<PickerResult> =>
  runTerminalSession<PickerResult>(({ requestRender, finish }) => {
    const store = createPickerStore(
      candidates,
      callbacks,
      (outcome) => finish(outcome),
      (reason) => finish({ type: "cancelled", reason }),
    );
    store.subscribe(requestRender);

    return {
      onKey: (event) => {
        if (isCtrlC(event)) {
          finish({ type: "cancelled", reason: "ctrlC" });
          return;
        }
        store.handleInput(event.input, event.key);
      },
      buildFrame: () =>
        renderPickerFrame({
          snapshot: store.getSnapshot(),
          width: terminalDimension(process.stderr.columns, DEFAULT_TERMINAL_WIDTH),
          height: terminalDimension(process.stderr.rows, DEFAULT_TERMINAL_HEIGHT),
          colorEnabled: colorEnabled(process.stderr),
        }),
    };
  });

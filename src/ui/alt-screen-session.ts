import type { render } from "ink";
import { EXIT_CANCELLED } from "../domain/result.ts";
import { type AltScreenTarget, enterAltScreen, leaveAltScreen } from "./alt-screen.ts";

const createAltScreenTarget = (): AltScreenTarget => ({
  isTTY: process.stderr.isTTY === true,
  write: (data) => {
    process.stderr.write(data);
  },
});

/**
 * Runs an ink render inside the terminal's alternate screen buffer (fzf/vim
 * style) so it never gets pushed into scrollback history, and resolves
 * whatever `renderElement(finish)` passes to `finish`. This is generic (not
 * picker-specific) purely to keep picker.tsx's own import count under the
 * lint limit — see runPicker in picker.tsx for the concrete usage.
 *
 * `leaveOnce` is idempotent and wired into every exit path — a normal
 * `finish()` call, SIGINT, and a render()/unmount() throw — so the terminal
 * is never left stuck on the alt screen. It also runs on the process "exit"
 * event as a last-resort net for any path this function didn't anticipate.
 * The alt-screen leave always happens before `finish`'s caller resolves its
 * own promise, so any output the caller writes afterward lands on the
 * restored normal screen, not the one about to be torn down.
 *
 * OS-level SIGINT is a last-resort net, not the normal Ctrl+C path: ink puts
 * stdin in raw mode, so a real terminal delivers Ctrl+C as a keypress
 * (handled by the picker's own onCancel, not this signal). This only fires
 * if something bypasses raw mode (e.g. a `bun build --compile` binary where
 * it doesn't behave as expected) — same exit code (130) either way.
 */
export const runInAltScreenSession = <T>(
  renderElement: (finish: (result: T) => void) => ReturnType<typeof render>,
): Promise<T> =>
  new Promise((resolve) => {
    const altScreen = createAltScreenTarget();
    let hasLeftAltScreen = false;
    const leaveOnce = (): void => {
      if (hasLeftAltScreen) {
        return;
      }
      hasLeftAltScreen = true;
      leaveAltScreen(altScreen);
    };
    process.once("exit", leaveOnce);

    const instanceRef: { current: ReturnType<typeof render> | null } = {
      current: null,
    };
    const handleSigint = (): void => {
      leaveOnce();
      instanceRef.current?.unmount();
      process.exitCode = EXIT_CANCELLED;
      process.exit(EXIT_CANCELLED);
    };
    process.once("SIGINT", handleSigint);

    const finish = (result: T): void => {
      leaveOnce();
      process.removeListener("SIGINT", handleSigint);
      instanceRef.current?.unmount();
      resolve(result);
    };

    enterAltScreen(altScreen);
    try {
      instanceRef.current = renderElement(finish);
    } catch (error) {
      leaveOnce();
      process.removeListener("SIGINT", handleSigint);
      throw error;
    }
  });

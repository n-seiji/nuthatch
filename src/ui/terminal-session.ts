import { EXIT_CANCELLED } from "../domain/result.ts";
import { type AltScreenTarget, enterAltScreen, leaveAltScreen } from "./alt-screen.ts";
import { PickerKeyParser, type PickerKeyEvent } from "./picker-key-parser.ts";

/**
 * Owns the picker's raw-mode terminal lifecycle: alt screen, bracketed
 * paste, stdin raw mode, key decoding, resize-triggered re-renders, and
 * teardown on every exit path (normal finish, Esc/Ctrl+C, an exception, or
 * an external SIGINT). Replaces ink's render()/unmount() lifecycle (see
 * alt-screen-session.ts, which this supersedes for the picker — that module
 * is kept only for its enterAltScreen/leaveAltScreen primitives, reused
 * here) now that the picker draws itself instead of going through ink.
 *
 * Event-driven, not a render loop: a frame is (re)drawn whenever
 * `requestRender` is called — after a key is decoded and dispatched, on a
 * terminal resize, and whenever the caller's own async state changes (e.g.
 * picker-store.ts's delete/switchRoot mutations notify their subscribers,
 * which is wired to call `requestRender` too). Multiple triggers within the
 * same synchronous tick coalesce into a single frame (via a microtask), so
 * a burst of pasted characters doesn't repaint once per byte.
 */

const ESC = "";
const ENABLE_BRACKETED_PASTE = `${ESC}[?2004h`;
const DISABLE_BRACKETED_PASTE = `${ESC}[?2004l`;

/** How long to wait after a lone ESC byte before treating it as an actual Escape keypress, rather than the start of a not-yet-complete sequence. Real terminals send a full CSI/SS3 sequence effectively atomically (well under this), so this only ever delays a genuine Escape press, never a recognized combo. */
const PENDING_ESCAPE_TIMEOUT_MS = 25;

export interface TerminalSessionApi<T> {
  /** Schedules a repaint (coalesced — safe to call many times per tick). */
  readonly requestRender: () => void;
  /** Resolves the session's promise with `result`, tearing down the terminal first. Idempotent — a second call is ignored. */
  readonly finish: (result: T) => void;
}

export interface TerminalSessionHandlers {
  /** Called for every decoded key event. */
  readonly onKey: (event: PickerKeyEvent) => void;
  /** Builds the next frame's full content (including the cursor-home/clear escape codes — see picker-frame.ts's buildFrame). Called synchronously whenever a render is due. */
  readonly buildFrame: () => string;
}

interface TerminalSessionStreams {
  readonly stdin: NodeJS.ReadStream;
  readonly stderr: NodeJS.WriteStream;
}

const defaultStreams = (): TerminalSessionStreams => ({
  stdin: process.stdin,
  stderr: process.stderr,
});

/**
 * Runs one picker session. `createHandlers` receives the session API
 * (requestRender/finish) up front so it can close over them when building
 * its onKey/buildFrame handlers — mirrors the `finish`-callback pattern
 * alt-screen-session.ts uses for the same reason (the render logic needs a
 * way to end the session before the session itself exists).
 */
export const runTerminalSession = <T>(
  createHandlers: (api: TerminalSessionApi<T>) => TerminalSessionHandlers,
  streams: TerminalSessionStreams = defaultStreams(),
): Promise<T> =>
  new Promise((resolve) => {
    const { stdin, stderr } = streams;
    const altScreenTarget: AltScreenTarget = {
      isTTY: stderr.isTTY === true,
      write: (data) => {
        stderr.write(data);
      },
    };
    const isInteractive = stdin.isTTY === true && altScreenTarget.isTTY;

    const parser = new PickerKeyParser();
    let pendingEscapeTimer: ReturnType<typeof setTimeout> | null = null;
    let renderScheduled = false;
    let finished = false;
    let handlers: TerminalSessionHandlers | null = null;

    const clearPendingEscapeTimer = (): void => {
      if (pendingEscapeTimer !== null) {
        clearTimeout(pendingEscapeTimer);
        pendingEscapeTimer = null;
      }
    };

    const paint = (): void => {
      renderScheduled = false;
      if (finished || handlers === null) {
        return;
      }
      altScreenTarget.write(handlers.buildFrame());
    };

    const requestRender = (): void => {
      if (finished || renderScheduled) {
        return;
      }
      renderScheduled = true;
      queueMicrotask(paint);
    };

    let hasCleanedUp = false;
    const cleanup = (): void => {
      if (hasCleanedUp) {
        return;
      }
      hasCleanedUp = true;
      clearPendingEscapeTimer();
      if (isInteractive) {
        stdin.off("data", handleData);
        stdin.setRawMode?.(false);
        stdin.pause();
        altScreenTarget.write(DISABLE_BRACKETED_PASTE);
      }
      stderr.off("resize", handleResize);
      leaveAltScreen(altScreenTarget);
    };

    const finish = (result: T): void => {
      if (finished) {
        return;
      }
      finished = true;
      cleanup();
      process.removeListener("SIGINT", handleSigint);
      resolve(result);
    };

    const scheduleEscapeFlush = (): void => {
      clearPendingEscapeTimer();
      pendingEscapeTimer = setTimeout(() => {
        pendingEscapeTimer = null;
        const flushed = parser.flushPendingEscape();
        if (flushed !== null) {
          handlers?.onKey(flushed);
        }
      }, PENDING_ESCAPE_TIMEOUT_MS);
    };

    const handleData = (chunk: Buffer): void => {
      for (const event of parser.feed(chunk)) {
        handlers?.onKey(event);
      }
      if (parser.hasPendingEscape()) {
        scheduleEscapeFlush();
      } else {
        clearPendingEscapeTimer();
      }
    };

    const handleResize = (): void => {
      requestRender();
    };

    const handleSigint = (): void => {
      cleanup();
      process.exitCode = EXIT_CANCELLED;
      process.exit(EXIT_CANCELLED);
    };
    process.once("SIGINT", handleSigint);
    process.once("exit", cleanup);

    enterAltScreen(altScreenTarget);
    if (isInteractive) {
      altScreenTarget.write(ENABLE_BRACKETED_PASTE);
      stdin.setRawMode?.(true);
      stdin.resume();
      stdin.on("data", handleData);
    }

    handlers = createHandlers({ requestRender, finish });
    requestRender();
  });

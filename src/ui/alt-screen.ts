import { ESC } from "./ansi.ts";

const ENTER_ALT_SCREEN = `${ESC}[?1049h`;
const LEAVE_ALT_SCREEN = `${ESC}[?1049l`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;

export interface AltScreenTarget {
  readonly isTTY: boolean;
  readonly write: (data: string) => void;
}

/**
 * Switches the target (stderr, where the picker renders) into the
 * terminal's alternate screen buffer -- the same mechanism fzf/vim use --
 * so the picker's UI doesn't get pushed into scrollback history on every
 * run. Also hides the cursor, since the picker repaints the whole frame on
 * every keystroke and a blinking cursor would flicker across it.
 *
 * No-op when the target isn't a TTY (e.g. stderr piped/redirected):
 * writing control codes into a non-interactive stream would corrupt
 * whatever's consuming it.
 */
export const enterAltScreen = (target: AltScreenTarget): void => {
  if (!target.isTTY) {
    return;
  }
  target.write(ENTER_ALT_SCREEN + HIDE_CURSOR);
};

/** Restores the normal screen buffer and cursor visibility. Mirrors enterAltScreen's TTY guard. */
export const leaveAltScreen = (target: AltScreenTarget): void => {
  if (!target.isTTY) {
    return;
  }
  target.write(SHOW_CURSOR + LEAVE_ALT_SCREEN);
};

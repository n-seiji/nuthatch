// The escape character is built from its char code (rather than a literal
// \x1b/ESC byte in source) so no non-printable byte ends up in the file.
const ASCII_ESCAPE_CODE = 27;
const ESCAPE = String.fromCodePoint(ASCII_ESCAPE_CODE);
const ENTER_ALT_SCREEN = `${ESCAPE}[?1049h`;
const LEAVE_ALT_SCREEN = `${ESCAPE}[?1049l`;
const HIDE_CURSOR = `${ESCAPE}[?25l`;
const SHOW_CURSOR = `${ESCAPE}[?25h`;

export interface AltScreenTarget {
  readonly isTTY: boolean;
  readonly write: (data: string) => void;
}

/**
 * Switches the target (stderr, where the picker renders) into the
 * terminal's alternate screen buffer -- the same mechanism fzf/vim use --
 * so the picker's UI doesn't get pushed into scrollback history on every
 * run. Also hides the cursor, since ink repaints the whole frame on every
 * keystroke and a blinking cursor would flicker across it.
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

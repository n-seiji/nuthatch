/**
 * Pure key-handling logic for the picker, extracted from picker.tsx so it can
 * be unit tested without rendering ink. Ctrl+N/Ctrl+P and Ctrl+J/Ctrl+K mirror
 * the arrow keys (emacs and vim conventions, respectively — both coexist);
 * Ctrl+U clears the search query. Modifier keys (ctrl/meta) never leak into
 * the search query as literal characters.
 *
 * Three modes, three resolvers: list (resolvePickerKeyAction), the action
 * panel opened with Tab/→/Ctrl+L (resolvePanelKeyAction), and the y/N
 * confirmation overlay shown by the Ctrl+X delete shortcut
 * (resolveConfirmKeyAction). The panel renders as a side column next to the
 * list (see picker-layout.ts's isNarrowTerminal for the width below which it
 * falls back to stacking below the list instead), so ←/Ctrl+H close it back
 * to the list rather than doubling as movement — Tab also toggles it, for
 * terminals (e.g. Ghostty) that remap a chord like Cmd+K to Tab.
 */

/** Esc cancels quietly (exit 0, empty stdout); Ctrl+C cancels like a real interrupt (exit 130, same as SIGINT). */
export type PickerCancelReason = "esc" | "ctrlC";

export type PickerKeyAction =
  | { readonly type: "cancel"; readonly reason: PickerCancelReason }
  | { readonly type: "select" }
  | { readonly type: "up" }
  | { readonly type: "down" }
  | { readonly type: "clear" }
  | { readonly type: "backspace" }
  | { readonly type: "char"; readonly char: string }
  | { readonly type: "openPanel" }
  | { readonly type: "deleteShortcut" }
  | { readonly type: "rootSwitchShortcut" }
  | { readonly type: "ignore" };

export interface PickerKeyModifiers {
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly escape: boolean;
  readonly return: boolean;
  readonly tab: boolean;
  readonly upArrow: boolean;
  readonly downArrow: boolean;
  readonly leftArrow: boolean;
  readonly rightArrow: boolean;
  readonly backspace: boolean;
  readonly delete: boolean;
}

export const resolvePickerKeyAction = (input: string, key: PickerKeyModifiers): PickerKeyAction => {
  if (key.escape) {
    return { type: "cancel", reason: "esc" };
  }
  if (key.ctrl && input === "c") {
    return { type: "cancel", reason: "ctrlC" };
  }
  if (key.return) {
    return { type: "select" };
  }
  if (key.tab || key.rightArrow || (key.ctrl && input === "l")) {
    return { type: "openPanel" };
  }
  if (key.ctrl && input === "x") {
    return { type: "deleteShortcut" };
  }
  if (key.ctrl && input === "r") {
    return { type: "rootSwitchShortcut" };
  }
  if (key.upArrow || (key.ctrl && (input === "p" || input === "k"))) {
    return { type: "up" };
  }
  if (key.downArrow || (key.ctrl && (input === "n" || input === "j"))) {
    return { type: "down" };
  }
  if (key.ctrl && input === "u") {
    return { type: "clear" };
  }
  if (key.backspace || key.delete) {
    return { type: "backspace" };
  }
  if (input.length > 0 && !key.ctrl && !key.meta) {
    return { type: "char", char: input };
  }
  return { type: "ignore" };
};

/** Letters that act as shortcuts inside the action panel: c=cd, d=delete, r=switchRoot. */
export const PANEL_LETTER_SHORTCUTS = ["c", "d", "r"] as const;
export type PanelLetterShortcut = (typeof PANEL_LETTER_SHORTCUTS)[number];

export type PanelKeyAction =
  | { readonly type: "close" }
  | { readonly type: "up" }
  | { readonly type: "down" }
  | { readonly type: "confirm" }
  | { readonly type: "letter"; readonly char: PanelLetterShortcut }
  | { readonly type: "ignore" };

/**
 * Key handling for the action panel (now a side column, not an overlay).
 * Enter always runs the currently-highlighted action ("全アクション Enter
 * で完結できる" in the design); c/d/r are shortcuts that run that action
 * immediately regardless of highlight. Esc, Tab, ←, and Ctrl+H all close
 * the panel back to the list — ← and Ctrl+H mirror the → and Ctrl+L that
 * open it, so left/right never double as movement inside the panel (only
 * up/down do).
 */
export const resolvePanelKeyAction = (input: string, key: PickerKeyModifiers): PanelKeyAction => {
  if (key.escape || key.tab || key.leftArrow || (key.ctrl && input === "h")) {
    return { type: "close" };
  }
  if (key.return) {
    return { type: "confirm" };
  }
  if (key.upArrow || (key.ctrl && (input === "p" || input === "k"))) {
    return { type: "up" };
  }
  if (key.downArrow || (key.ctrl && (input === "n" || input === "j"))) {
    return { type: "down" };
  }
  if (!key.ctrl && !key.meta && isPanelLetterShortcut(input)) {
    return { type: "letter", char: input };
  }
  return { type: "ignore" };
};

const isPanelLetterShortcut = (input: string): input is PanelLetterShortcut =>
  (PANEL_LETTER_SHORTCUTS as readonly string[]).includes(input);

export type ConfirmKeyAction = { readonly type: "yes" } | { readonly type: "no" };

/**
 * Key handling for the y/N delete-confirmation overlay (Ctrl+X shortcut).
 * Only y/Y confirms; everything else — including Escape, n/N, or any other
 * key — cancels back to the list, matching the "N" default of a y/N prompt.
 */
export const resolveConfirmKeyAction = (
  input: string,
  key: PickerKeyModifiers,
): ConfirmKeyAction => {
  if (!key.ctrl && !key.meta && (input === "y" || input === "Y")) {
    return { type: "yes" };
  }
  return { type: "no" };
};

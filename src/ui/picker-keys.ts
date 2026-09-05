/**
 * Pure key-handling logic for the picker, extracted from picker.tsx so it can
 * be unit tested without rendering ink. Ctrl+N/Ctrl+P mirror the arrow keys
 * (emacs/macOS convention); Ctrl+U clears the search query. Modifier keys
 * (ctrl/meta) never leak into the search query as literal characters.
 */

export type PickerKeyAction =
  | { readonly type: "cancel" }
  | { readonly type: "select" }
  | { readonly type: "up" }
  | { readonly type: "down" }
  | { readonly type: "clear" }
  | { readonly type: "backspace" }
  | { readonly type: "char"; readonly char: string }
  | { readonly type: "ignore" };

export interface PickerKeyModifiers {
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly escape: boolean;
  readonly return: boolean;
  readonly upArrow: boolean;
  readonly downArrow: boolean;
  readonly backspace: boolean;
  readonly delete: boolean;
}

export const resolvePickerKeyAction = (input: string, key: PickerKeyModifiers): PickerKeyAction => {
  if (key.escape || (key.ctrl && input === "c")) {
    return { type: "cancel" };
  }
  if (key.return) {
    return { type: "select" };
  }
  if (key.upArrow || (key.ctrl && input === "p")) {
    return { type: "up" };
  }
  if (key.downArrow || (key.ctrl && input === "n")) {
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

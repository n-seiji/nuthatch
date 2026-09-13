import type { PickerKeyModifiers } from "./picker-keys.ts";

/** Shared event shape + constructor for picker-key-parser.ts and picker-key-csi.ts — split into its own module so neither has to import the other just for this. */

const NO_MODIFIERS: PickerKeyModifiers = {
  ctrl: false,
  meta: false,
  escape: false,
  return: false,
  tab: false,
  upArrow: false,
  downArrow: false,
  leftArrow: false,
  rightArrow: false,
  backspace: false,
  delete: false,
};

export interface PickerKeyEvent {
  readonly input: string;
  readonly key: PickerKeyModifiers;
}

export const event = (input: string, key: Partial<PickerKeyModifiers> = {}): PickerKeyEvent => ({
  input,
  key: { ...NO_MODIFIERS, ...key },
});

export const withMeta = (keyEvent: PickerKeyEvent): PickerKeyEvent => ({
  input: keyEvent.input,
  key: { ...keyEvent.key, meta: true },
});

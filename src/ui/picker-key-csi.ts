import type { PickerKeyModifiers } from "./picker-keys.ts";
import { event, type PickerKeyEvent } from "./picker-key-event.ts";

/**
 * CSI (`ESC [ ...`) and SS3 (`ESC O <byte>`) sequence parsing, split out of
 * picker-key-parser.ts to keep that file under the lint line-count limit.
 * Pure — takes the raw buffer starting at the sequence, returns how much of
 * it was consumed and what it meant. See picker-key-parser.ts's module
 * comment for the overall byte-level contract this feeds into.
 */

const ARROW_FINAL_BYTE_A = "A".codePointAt(0) as number;
const ARROW_FINAL_BYTE_B = "B".codePointAt(0) as number;
const ARROW_FINAL_BYTE_C = "C".codePointAt(0) as number;
const ARROW_FINAL_BYTE_D = "D".codePointAt(0) as number;

const arrowModifierKey = (finalByte: number): keyof PickerKeyModifiers | null => {
  if (finalByte === ARROW_FINAL_BYTE_A) {
    return "upArrow";
  }
  if (finalByte === ARROW_FINAL_BYTE_B) {
    return "downArrow";
  }
  if (finalByte === ARROW_FINAL_BYTE_C) {
    return "rightArrow";
  }
  if (finalByte === ARROW_FINAL_BYTE_D) {
    return "leftArrow";
  }
  return null;
};

/** Xterm's CSI modifier parameter: 1 + shift(1) + alt(2) + ctrl(4). */
const modifierBitsFromParam = (param: number): { ctrl: boolean; meta: boolean } => {
  const bits = param - 1;
  const CTRL_BIT = 4;
  const ALT_BIT = 2;
  return { ctrl: (bits & CTRL_BIT) !== 0, meta: (bits & ALT_BIT) !== 0 };
};

const CSI_FINAL_BYTE_MIN = 0x40;
const CSI_FINAL_BYTE_MAX = 0x7e;
const isCsiFinalByte = (byte: number): boolean =>
  byte >= CSI_FINAL_BYTE_MIN && byte <= CSI_FINAL_BYTE_MAX;

export const BRACKETED_PASTE_START = "200~";
export const BRACKETED_PASTE_END = "201~";

/** What one complete CSI/SS3 sequence resolved to, plus how many bytes it consumed. */
export type SequenceResult =
  | { readonly kind: "incomplete" }
  | {
      readonly kind: "resolved";
      readonly consumed: number;
      readonly event: PickerKeyEvent | null;
      readonly pasteStarted?: true;
      readonly pasteEnded?: true;
    };

const modifiedArrowOrDelete = (paramText: string, finalByte: string): PickerKeyEvent | null => {
  const MODIFIED_PATTERN = /^\d+;\d+$/u;
  const DELETE_PARAM = "3";
  if (
    finalByte === "~" &&
    (paramText === DELETE_PARAM || paramText.startsWith(`${DELETE_PARAM};`))
  ) {
    return event("", { delete: true });
  }
  const arrowKey = arrowModifierKey(finalByte.codePointAt(0) as number);
  if (arrowKey === null || !(paramText === "" || MODIFIED_PATTERN.test(paramText))) {
    return null;
  }
  const [, modifierParam] = paramText.split(";");
  const mods = modifierParam === undefined ? {} : modifierBitsFromParam(Number(modifierParam));
  return event("", { [arrowKey]: true, ...mods });
};

/** Parses one CSI sequence (`ESC [ ...`) starting at `buf[0] === ESC`. */
export const parseCsi = (buf: Buffer): SequenceResult => {
  const CSI_PREFIX_LENGTH = 2;
  let index = CSI_PREFIX_LENGTH;
  let paramText = "";
  while (index < buf.length && !isCsiFinalByte(buf[index] as number)) {
    paramText += String.fromCodePoint(buf[index] as number);
    index += 1;
  }
  if (index >= buf.length) {
    return { kind: "incomplete" };
  }
  const finalByte = String.fromCodePoint(buf[index] as number);
  const consumed = index + 1;
  const full = paramText + finalByte;

  if (full === BRACKETED_PASTE_START) {
    return { kind: "resolved", consumed, event: null, pasteStarted: true };
  }
  if (full === BRACKETED_PASTE_END) {
    return { kind: "resolved", consumed, event: null, pasteEnded: true };
  }

  return {
    kind: "resolved",
    consumed,
    event: modifiedArrowOrDelete(paramText, finalByte),
  };
};

const SS3_SEQUENCE_LENGTH = 3;

/** Parses `ESC O <byte>` (application cursor mode arrows). */
export const parseSs3 = (buf: Buffer): SequenceResult => {
  if (buf.length < SS3_SEQUENCE_LENGTH) {
    return { kind: "incomplete" };
  }
  const finalByte = buf[2] as number;
  const arrowKey = arrowModifierKey(finalByte);
  return {
    kind: "resolved",
    consumed: SS3_SEQUENCE_LENGTH,
    event: arrowKey === null ? null : event("", { [arrowKey]: true }),
  };
};

import { event, type PickerKeyEvent } from "./picker-key-event.ts";
import type { PickerKeyModifiers } from "./picker-keys.ts";

/**
 * CSI (`ESC [ ...`) and SS3 (`ESC O <byte>`) sequence parsing, split out of
 * picker-key-parser.ts to keep that file under the lint line-count limit.
 * Pure — takes the raw buffer starting at the sequence, returns how much of
 * it was consumed and what it meant. Only plain arrows and Delete are
 * recognized; modifier parameters (`ESC[1;5A`) are ignored, so a modified
 * arrow acts as the plain arrow.
 */

const ARROW_KEYS: ReadonlyMap<string, keyof PickerKeyModifiers> = new Map([
  ["A", "upArrow"],
  ["B", "downArrow"],
  ["C", "rightArrow"],
  ["D", "leftArrow"],
]);

const CSI_FINAL_BYTE_MIN = 0x40;
const CSI_FINAL_BYTE_MAX = 0x7e;
const isCsiFinalByte = (byte: number): boolean =>
  byte >= CSI_FINAL_BYTE_MIN && byte <= CSI_FINAL_BYTE_MAX;

/** What one complete CSI/SS3 sequence resolved to, plus how many bytes it consumed. */
export type SequenceResult =
  | { readonly kind: "incomplete" }
  | {
      readonly kind: "resolved";
      readonly consumed: number;
      readonly event: PickerKeyEvent | null;
    };

const DELETE_PARAM = "3";

const csiEvent = (paramText: string, finalByte: string): PickerKeyEvent | null => {
  if (finalByte === "~") {
    const [first] = paramText.split(";");
    return first === DELETE_PARAM ? event("", { delete: true }) : null;
  }
  const arrowKey = ARROW_KEYS.get(finalByte);
  return arrowKey === undefined ? null : event("", { [arrowKey]: true });
};

/** Parses one CSI sequence (`ESC [ ...`) starting at `buf[0] === ESC`. */
export const parseCsi = (buf: Buffer): SequenceResult => {
  const CSI_PREFIX_LENGTH = 2;
  let index = CSI_PREFIX_LENGTH;
  while (index < buf.length && !isCsiFinalByte(buf[index] as number)) {
    index += 1;
  }
  if (index >= buf.length) {
    return { kind: "incomplete" };
  }
  const paramText = buf.subarray(CSI_PREFIX_LENGTH, index).toString("latin1");
  return {
    kind: "resolved",
    consumed: index + 1,
    event: csiEvent(paramText, String.fromCodePoint(buf[index] as number)),
  };
};

const SS3_SEQUENCE_LENGTH = 3;

/** Parses `ESC O <byte>` (application cursor mode arrows). */
export const parseSs3 = (buf: Buffer): SequenceResult => {
  if (buf.length < SS3_SEQUENCE_LENGTH) {
    return { kind: "incomplete" };
  }
  const arrowKey = ARROW_KEYS.get(String.fromCodePoint(buf[2] as number));
  return {
    kind: "resolved",
    consumed: SS3_SEQUENCE_LENGTH,
    event: arrowKey === undefined ? null : event("", { [arrowKey]: true }),
  };
};

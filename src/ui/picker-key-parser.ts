import { event, withMeta, type PickerKeyEvent } from "./picker-key-event.ts";
import { BRACKETED_PASTE_END, parseCsi, parseSs3 } from "./picker-key-csi.ts";

export type { PickerKeyEvent } from "./picker-key-event.ts";

/**
 * Converts raw stdin bytes (as read in raw mode, without ink) into the same
 * `{input, key}` shape `resolvePickerKeyAction`/`resolvePanelKeyAction`/
 * `resolveConfirmKeyAction` already expect. Ink used to own this translation
 * (via a bundled fork of the `keypress` module); this is a from-scratch
 * replacement kept deliberately narrow — it only recognizes the sequences
 * the picker's key resolvers actually branch on (see picker-keys.ts's module
 * comment for the exact byte-level contract Ctrl+J/Ctrl+H rely on).
 *
 * Chunk boundaries are not key boundaries: a single `read()`/`data` event can
 * split a UTF-8 codepoint, split an escape sequence across two chunks, or
 * bundle several complete keys together (fast typing, or a paste). This
 * parser buffers incomplete bytes across `feed()` calls and can emit more
 * than one event per call.
 *
 * A lone ESC (Escape key press, no following bytes) is indistinguishable
 * from the *start* of a multi-byte escape sequence until more bytes either
 * arrive or don't — `feed()` never resolves a trailing bare ESC on its own;
 * the caller must give it a short grace period (see PENDING_ESCAPE_TIMEOUT_MS
 * in terminal-session.ts) and then call `flushPendingEscape()`.
 *
 * CSI/SS3 sequence decoding lives in picker-key-csi.ts (split out to keep
 * this file under the lint line-count limit).
 */

const ESC = 0x1b;
const BACKSPACE_DEL = 0x7f;
const BACKSPACE_BS = 0x08;
const TAB = 0x09;
const LF = 0x0a;
const CR = 0x0d;

/** Ctrl+<letter> byte range, 0x01-0x1A, mapped back to the lowercase letter. Excludes the bytes ink/terminals special-case as their own named keys (Tab, LF, CR, Backspace) — those are handled before this range is consulted. */
const CTRL_LETTER_START = 0x01;
const CTRL_LETTER_END = 0x1a;
const CTRL_LETTER_OFFSET = "a".codePointAt(0) as number;
const ctrlLetterFromByte = (byte: number): string =>
  String.fromCodePoint(byte + CTRL_LETTER_OFFSET - 1);

const ONE_BYTE_MAX = 0x7f;
const TWO_BYTE_MASK = 0xe0;
const TWO_BYTE_PREFIX = 0xc0;
const THREE_BYTE_MASK = 0xf0;
const THREE_BYTE_PREFIX = 0xe0;
const FOUR_BYTE_MASK = 0xf8;
const FOUR_BYTE_PREFIX = 0xf0;
const UTF8_ONE_BYTE_LENGTH = 1;
const UTF8_TWO_BYTE_LENGTH = 2;
const UTF8_THREE_BYTE_LENGTH = 3;
const UTF8_FOUR_BYTE_LENGTH = 4;

/** How many bytes a UTF-8 sequence starting with `leadByte` should occupy in total. */
const utf8SequenceLength = (leadByte: number): number => {
  if (leadByte <= ONE_BYTE_MAX) {
    return UTF8_ONE_BYTE_LENGTH;
  }
  if ((leadByte & TWO_BYTE_MASK) === TWO_BYTE_PREFIX) {
    return UTF8_TWO_BYTE_LENGTH;
  }
  if ((leadByte & THREE_BYTE_MASK) === THREE_BYTE_PREFIX) {
    return UTF8_THREE_BYTE_LENGTH;
  }
  if ((leadByte & FOUR_BYTE_MASK) === FOUR_BYTE_PREFIX) {
    return UTF8_FOUR_BYTE_LENGTH;
  }
  return UTF8_ONE_BYTE_LENGTH;
};

const decodeUtf8 = (bytes: Buffer): string =>
  new TextDecoder("utf-8", { fatal: false }).decode(bytes);

const CSI_INTRODUCER_CODE = "[".codePointAt(0) as number;
const SS3_INTRODUCER_CODE = "O".codePointAt(0) as number;

/** Ceiling on how many buffered bytes an incomplete CSI/SS3 sequence may reach before it's discarded outright. Real sequences (arrow keys, modified arrows, delete, bracketed-paste markers) are all well under this; a buffer growing past it means we're not actually looking at a real sequence (e.g. framing got out of sync), so holding it forever waiting for a final byte that will never come would leave the parser stuck. */
const MAX_PENDING_SEQUENCE_BYTES = 32;

/**
 * Byte-level stdin parser feeding the picker's key resolvers. Not
 * thread-safe/re-entrant — one instance per picker session, fed serially
 * from a single 'data' listener (see terminal-session.ts).
 */
export class PickerKeyParser {
  private buffer: Buffer = Buffer.alloc(0);
  private inPaste = false;

  /** Whether a trailing, still-ambiguous ESC byte is buffered — the caller should start/refresh a short timer while true. False during a paste even when the buffer holds a single trailing ESC byte: stepPaste's overlap handling holds that byte back as a possible prefix of the `ESC[201~` end marker, not a candidate Escape keypress, so the caller's pending-escape timer must never fire on it (doing so would flush a fake Escape and drop the marker's remaining bytes, leaving the parser stuck in paste mode -- see picker-key-parser.test.ts). */
  hasPendingEscape(): boolean {
    return !this.inPaste && this.buffer.length === 1 && this.buffer[0] === ESC;
  }

  /** Called after the caller's grace period elapses with no further bytes: resolves the buffered lone ESC as an actual Escape keypress. */
  flushPendingEscape(): PickerKeyEvent | null {
    if (!this.hasPendingEscape()) {
      return null;
    }
    this.buffer = Buffer.alloc(0);
    return event("", { escape: true });
  }

  feed(chunk: Buffer): PickerKeyEvent[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const results: PickerKeyEvent[] = [];
    let step = this.inPaste ? this.stepPaste() : this.step();
    while (step !== null) {
      results.push(...step);
      step = this.inPaste ? this.stepPaste() : this.step();
    }
    return results;
  }

  /**
   * One decode step while bracketed paste is active: everything up to the
   * ESC[201~ end marker is literal text (never interpreted as a command --
   * see the module comment), even a stray ESC the pasted content itself
   * contains. Holds back a trailing byte run that could be an in-progress
   * prefix of the end marker rather than emitting it as text prematurely,
   * so a marker split across two chunks is still recognized.
   */
  private stepPaste(): PickerKeyEvent[] | null {
    if (this.buffer.length === 0) {
      return null;
    }
    const endMarker = Buffer.concat([Buffer.from([ESC]), Buffer.from(`[${BRACKETED_PASTE_END}`)]);
    const markerIndex = this.buffer.indexOf(endMarker);
    if (markerIndex !== -1) {
      const text = decodeUtf8(this.buffer.subarray(0, markerIndex));
      this.buffer = this.buffer.subarray(markerIndex + endMarker.length);
      this.inPaste = false;
      return [...text].map((char) => event(char));
    }

    const maxOverlap = Math.min(endMarker.length - 1, this.buffer.length);
    let overlap = 0;
    for (let candidate = maxOverlap; candidate > 0; candidate -= 1) {
      const tail = this.buffer.subarray(this.buffer.length - candidate);
      if (tail.equals(endMarker.subarray(0, candidate))) {
        overlap = candidate;
        break;
      }
    }
    const safeLength = this.buffer.length - overlap;
    if (safeLength === 0) {
      return null;
    }
    const text = decodeUtf8(this.buffer.subarray(0, safeLength));
    this.buffer = this.buffer.subarray(safeLength);
    return text.length > 0 ? [...text].map((char) => event(char)) : null;
  }

  private step(): PickerKeyEvent[] | null {
    if (this.buffer.length === 0) {
      return null;
    }
    const first = this.buffer[0] as number;

    if (first === ESC) {
      return this.stepEscape();
    }
    if (first === CR) {
      this.buffer = this.buffer.subarray(1);
      return [event("", { return: true })];
    }
    if (first === LF) {
      this.buffer = this.buffer.subarray(1);
      return [event("\n")];
    }
    if (first === TAB) {
      this.buffer = this.buffer.subarray(1);
      return [event("", { tab: true })];
    }
    if (first === BACKSPACE_DEL || first === BACKSPACE_BS) {
      this.buffer = this.buffer.subarray(1);
      return [event("", { backspace: true })];
    }
    if (first >= CTRL_LETTER_START && first <= CTRL_LETTER_END) {
      this.buffer = this.buffer.subarray(1);
      return [event(ctrlLetterFromByte(first), { ctrl: true })];
    }
    return this.stepUtf8Char();
  }

  private stepEscape(): PickerKeyEvent[] | null {
    if (this.buffer.length === 1) {
      // Ambiguous: could be a lone Escape, or the start of a longer sequence -- leave it buffered for flushPendingEscape/more bytes.
      return null;
    }
    const second = this.buffer[1] as number;
    if (second === CSI_INTRODUCER_CODE) {
      return this.applySequence(parseCsi(this.buffer));
    }
    if (second === SS3_INTRODUCER_CODE) {
      return this.applySequence(parseSs3(this.buffer));
    }
    // Alt+<char>: ESC immediately followed by a printable byte that isn't a CSI/SS3 introducer.
    // Consume ESC, then decode the following char(s) as meta-modified input.
    this.buffer = this.buffer.subarray(1);
    const inner = this.stepUtf8Char();
    return inner === null ? null : inner.map((keyEvent) => withMeta(keyEvent));
  }

  private applySequence(result: ReturnType<typeof parseCsi>): PickerKeyEvent[] | null {
    if (result.kind === "incomplete") {
      /* A sequence that never reaches its final byte (garbled framing, or a key that isn't one we recognize) would otherwise hold the buffer forever, absorbing every later byte -- including a real Ctrl+C -- as more "parameters". Cap how long we'll wait for one. */
      if (this.buffer.length > MAX_PENDING_SEQUENCE_BYTES) {
        this.buffer = Buffer.alloc(0);
      }
      return null;
    }
    if (result.kind === "interrupted") {
      this.buffer = this.buffer.subarray(result.consumed);
      return [result.event];
    }
    this.buffer = this.buffer.subarray(result.consumed);
    if (result.pasteStarted === true) {
      this.inPaste = true;
    }
    if (result.pasteEnded === true) {
      this.inPaste = false;
    }
    return result.event === null ? [] : [result.event];
  }

  private stepUtf8Char(): PickerKeyEvent[] | null {
    const leadByte = this.buffer[0] as number;
    const length = utf8SequenceLength(leadByte);
    if (this.buffer.length < length) {
      return null;
    }
    const bytes = this.buffer.subarray(0, length);
    this.buffer = this.buffer.subarray(length);
    const char = decodeUtf8(bytes);
    return char.length > 0 ? [event(char)] : [];
  }
}

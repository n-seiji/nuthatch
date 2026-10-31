import { event, type PickerKeyEvent } from "./picker-key-event.ts";
import { parseCsi, parseSs3 } from "./picker-key-csi.ts";

export type { PickerKeyEvent } from "./picker-key-event.ts";

/**
 * Bracketed paste (`ESC[200~ ... ESC[201~`, enabled by terminal-session.ts)
 * is the safety mechanism for pasted text: its content becomes query text
 * only, with every control character dropped, so a paste can never open the
 * action panel or trigger delete / switch-root.
 *
 * Converts raw stdin bytes (as read in raw mode) into the `{input, key}`
 * shape `resolvePickerKeyAction`/`resolvePanelKeyAction`/
 * `resolveConfirmKeyAction` expect. Kept deliberately narrow — it only
 * recognizes the sequences the picker's key resolvers actually branch on
 * (see picker-keys.ts's module comment for the byte-level contract Ctrl+H
 * relies on).
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

/** Ctrl+<letter> byte range, 0x01-0x1A, mapped back to the lowercase letter. Excludes the bytes terminals treat as their own named keys (Tab, CR, Backspace) and LF, which is ignored — those are handled before this range is consulted. */
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

/** Below this codepoint, a character is a C0 control code rather than printable text — never something the picker's single-line query should render or act on literally. */
const CONTROL_CODEPOINT_MAX = 0x1f;

/** DEL and the C1 control range (U+0080-U+009F) -- pasted text is decoded UTF-8, so unlike the byte-level path these can validly appear as their own codepoints and must be filtered explicitly. */
const DEL_CODEPOINT = 0x7f;
const C1_CONTROL_MIN = 0x80;
const C1_CONTROL_MAX = 0x9f;

const isPrintableChar = (char: string): boolean => {
  const codePoint = char.codePointAt(0) ?? 0;
  if (codePoint <= CONTROL_CODEPOINT_MAX || codePoint === DEL_CODEPOINT) {
    return false;
  }
  return codePoint < C1_CONTROL_MIN || codePoint > C1_CONTROL_MAX;
};

/** Pasted text becomes query characters only: C0 (Tab/CR/LF included), DEL and C1 controls are dropped, so nothing in a paste can act as a key (Tab opening the panel, Ctrl+X/Ctrl+R shortcuts, Enter). */
const pastedTextToEvents = (text: string): PickerKeyEvent[] =>
  [...text].filter((char) => isPrintableChar(char)).map((char) => event(char));

const PASTE_START_MARKER = Buffer.from("\u001B[200~", "latin1");
const PASTE_END_MARKER = Buffer.from("\u001B[201~", "latin1");

const CSI_INTRODUCER_CODE = "[".codePointAt(0) as number;
const SS3_INTRODUCER_CODE = "O".codePointAt(0) as number;

/** Ceiling on how many buffered bytes an incomplete CSI/SS3 sequence may reach before it's discarded outright. Real sequences (arrow keys, modified arrows, delete) are all well under this; a buffer growing past it means we're not actually looking at a real sequence (e.g. framing got out of sync), so holding it forever waiting for a final byte that will never come would leave the parser stuck. */
const MAX_PENDING_SEQUENCE_BYTES = 32;

/**
 * Byte-level stdin parser feeding the picker's key resolvers. Not
 * thread-safe/re-entrant — one instance per picker session, fed serially
 * from a single 'data' listener (see terminal-session.ts).
 */
export class PickerKeyParser {
  private buffer: Buffer = Buffer.alloc(0);
  private inPaste = false;

  /** Whether a trailing, still-ambiguous ESC byte is buffered — the caller should start/refresh a short timer while true. Never during a paste: a trailing ESC there may be the start of the end marker, not an Escape keypress. */
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

  /** One decode step inside a bracketed paste: everything up to ESC[201~ is text. A trailing run that could be a prefix of the end marker is held back so a marker split across reads is still recognized. */
  private stepPaste(): PickerKeyEvent[] | null {
    if (this.buffer.length === 0) {
      return null;
    }
    const markerIndex = this.buffer.indexOf(PASTE_END_MARKER);
    if (markerIndex !== -1) {
      const text = decodeUtf8(this.buffer.subarray(0, markerIndex));
      this.buffer = this.buffer.subarray(markerIndex + PASTE_END_MARKER.length);
      this.inPaste = false;
      return pastedTextToEvents(text);
    }
    let overlap = 0;
    for (
      let candidate = Math.min(PASTE_END_MARKER.length - 1, this.buffer.length);
      candidate > 0;
      candidate -= 1
    ) {
      if (
        this.buffer
          .subarray(this.buffer.length - candidate)
          .equals(PASTE_END_MARKER.subarray(0, candidate))
      ) {
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
    return text.length > 0 ? pastedTextToEvents(text) : null;
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
      // Ignored (not Ctrl+J, not Enter): a pasted trailing newline must not move the selection or fill the query.
      this.buffer = this.buffer.subarray(1);
      return [];
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
    if (first <= CONTROL_CODEPOINT_MAX) {
      // A C0 control byte not covered above (0x00, 0x1C-0x1F -- ESC/CR/LF/TAB and the Ctrl+letter range are all handled by now). Drop it rather than let it flow into the query as an invisible character that still gets written to the terminal.
      this.buffer = this.buffer.subarray(1);
      return [];
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
      if (this.buffer.subarray(0, PASTE_START_MARKER.length).equals(PASTE_START_MARKER)) {
        this.buffer = this.buffer.subarray(PASTE_START_MARKER.length);
        this.inPaste = true;
        return [];
      }
      return this.applySequence(parseCsi(this.buffer));
    }
    if (second === SS3_INTRODUCER_CODE) {
      return this.applySequence(parseSs3(this.buffer));
    }
    // Not a CSI/SS3 introducer (e.g. Alt+<letter>): treat the ESC as a plain Escape and leave the following bytes to be parsed as ordinary keys.
    this.buffer = this.buffer.subarray(1);
    return [event("", { escape: true })];
  }

  private applySequence(result: ReturnType<typeof parseCsi>): PickerKeyEvent[] | null {
    if (result.kind === "incomplete") {
      /* A sequence that never reaches its final byte (garbled framing) would otherwise hold the buffer forever, absorbing every later byte as more "parameters". Cap how long we'll wait for one. Note: bytes after `ESC[` (Ctrl+C included) are held until a final byte arrives or this cap is hit. */
      if (this.buffer.length > MAX_PENDING_SEQUENCE_BYTES) {
        this.buffer = Buffer.alloc(0);
      }
      return null;
    }
    this.buffer = this.buffer.subarray(result.consumed);
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

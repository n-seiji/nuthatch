import { displayWidth, graphemes } from "../domain/display-width.ts";

// Re-exported so picker.ts (already at its import-count budget) doesn't
// Need a separate import source just for the query line's tail-preserving
// Truncation -- see picker.ts's queryLine.
export { truncateToWidthKeepingTail } from "../domain/display-width.ts";

/**
 * Pure frame builder for the self-drawn picker (replaces ink's render tree).
 * Turns a list of styled lines (the left column: query/rows/legend/footer,
 * and optionally a right column: the action/confirm panel) into one ANSI
 * string to write in a single `process.stderr.write` call per frame — see
 * terminal-session.ts for the write side.
 *
 * Never diffs against a previous frame: every frame clears from the cursor
 * to the end of the screen (`ESC[H` + `ESC[J`) before drawing, so a frame
 * with fewer rows than the last one (search narrowing the list, closing the
 * panel) never leaves residual lines behind, without tracking previous
 * frame height at all. This costs a full repaint every keystroke, which is
 * cheap at the picker's scale (tens of rows) and simpler/more robust than
 * line-level diffing.
 */

const ESC = "";
const CURSOR_HOME = `${ESC}[H`;
const CLEAR_TO_END = `${ESC}[J`;
const SGR_RESET = `${ESC}[0m`;

export type LineStyle = "plain" | "cyan" | "dim" | "bold-dim" | "inverse" | "red";

export interface StyledSpan {
  readonly text: string;
  readonly style?: LineStyle;
}

/** One display line, as a sequence of spans (so e.g. "hop: " + cyan query + dim hint can share a row). */
export type StyledLine = readonly StyledSpan[];

const SGR_CODES: Record<LineStyle, string> = {
  plain: "",
  cyan: `${ESC}[36m`,
  dim: `${ESC}[2m`,
  "bold-dim": `${ESC}[1m${ESC}[2m`,
  inverse: `${ESC}[7m`,
  red: `${ESC}[31m`,
};

const renderSpan = (span: StyledSpan, colorEnabled: boolean): string => {
  const style = span.style ?? "plain";
  if (!colorEnabled || style === "plain") {
    return span.text;
  }
  return `${SGR_CODES[style]}${span.text}${SGR_RESET}`;
};

const lineWidth = (line: StyledLine): number =>
  line.reduce((total, span) => total + displayWidth(span.text), 0);

const renderLine = (line: StyledLine, colorEnabled: boolean): string =>
  line.map((span) => renderSpan(span, colorEnabled)).join("");

/** Pads a rendered left-column line (already containing SGR codes) out to `width` display columns, by appending plain spaces — SGR codes take no display width so displayWidth-based padding on the raw text is computed first. */
const padRenderedLine = (line: StyledLine, rendered: string, width: number): string => {
  const gap = Math.max(0, width - lineWidth(line));
  return gap === 0 ? rendered : rendered + " ".repeat(gap);
};

export interface FrameInput {
  /** The list column: query line, candidate rows, legend, footer. */
  readonly left: readonly StyledLine[];
  /** The side panel (action panel / confirm), or null when not shown. */
  readonly right: readonly StyledLine[] | null;
  /** True when the panel must stack below the list instead of beside it (see picker-layout.ts's isNarrowTerminal). Ignored when `right` is null. */
  readonly stacked: boolean;
  /** False disables all SGR output — NO_COLOR, a non-TTY stderr, or a terminal that reports no color support. Selection is still shown via the "❯ "/"  " marker regardless. */
  readonly colorEnabled: boolean;
}

/** The horizontal gap between the list column and the side panel in the non-stacked layout — exported so picker.ts can factor it into the minimum width needed for side-by-side (see picker-layout.ts's dynamic narrow-terminal threshold). */
export const GUTTER = "  ";

const buildSideBySide = (
  left: readonly StyledLine[],
  right: readonly StyledLine[],
  colorEnabled: boolean,
): string[] => {
  const leftWidth = Math.max(0, ...left.map((line) => lineWidth(line)));
  const rowCount = Math.max(left.length, right.length);
  const rows: string[] = [];
  for (let index = 0; index < rowCount; index += 1) {
    const leftLine = left[index] ?? [];
    const rightLine = right[index] ?? [];
    const renderedLeft = padRenderedLine(leftLine, renderLine(leftLine, colorEnabled), leftWidth);
    const renderedRight = renderLine(rightLine, colorEnabled);
    rows.push(index < left.length ? `${renderedLeft}${GUTTER}${renderedRight}` : renderedRight);
  }
  return rows;
};

const BOX_TOP_LEFT = "\u256D";
const BOX_TOP_RIGHT = "\u256E";
const BOX_BOTTOM_LEFT = "\u2570";
const BOX_BOTTOM_RIGHT = "\u256F";
const BOX_HORIZONTAL = "\u2500";
const BOX_VERTICAL = "\u2502";
const BOX_PADDING = 1;
const BOX_PADDING_TOTAL = BOX_PADDING + BOX_PADDING;
const BOX_BORDER_WIDTH = 2;

interface StyledGrapheme {
  readonly text: string;
  readonly style: LineStyle | undefined;
}

const flattenToGraphemes = (line: StyledLine): StyledGrapheme[] =>
  line.flatMap((span) => graphemes(span.text).map((text) => ({ text, style: span.style })));

const toStyledSpan = (char: StyledGrapheme): StyledSpan =>
  char.style === undefined ? { text: char.text } : { text: char.text, style: char.style };

/** Regroups a flat grapheme+style list back into spans, merging consecutive graphemes that share a style so wrapping doesn't fragment a line into one span per character. */
const groupIntoSpans = (chars: readonly StyledGrapheme[]): StyledLine => {
  const spans: StyledSpan[] = [];
  for (const char of chars) {
    const last = spans.at(-1);
    if (last !== undefined && last.style === char.style) {
      spans[spans.length - 1] = toStyledSpan({
        text: last.text + char.text,
        style: last.style,
      });
    } else {
      spans.push(toStyledSpan(char));
    }
  }
  return spans;
};

/**
 * Wraps one line to at most `width` display columns per row, breaking at
 * grapheme-cluster boundaries (never mid-cluster, so CJK/emoji content is
 * never split in half) rather than at word boundaries -- good enough for
 * branch names, paths, and the panel's short fixed copy, none of which have
 * natural word-wrap points anyway. Always returns at least one row (an
 * empty line still needs a row to close the box on).
 */
const wrapLineToWidth = (line: StyledLine, width: number): StyledLine[] => {
  if (width <= 0) {
    return [line];
  }
  const rows: StyledLine[] = [];
  let current: StyledGrapheme[] = [];
  let currentWidth = 0;
  for (const char of flattenToGraphemes(line)) {
    const charWidth = displayWidth(char.text);
    if (currentWidth + charWidth > width && current.length > 0) {
      rows.push(groupIntoSpans(current));
      current = [];
      currentWidth = 0;
    }
    current.push(char);
    currentWidth += charWidth;
  }
  if (current.length > 0 || rows.length === 0) {
    rows.push(groupIntoSpans(current));
  }
  return rows;
};

/**
 * Wraps `content` in a round-cornered border, `width` display columns wide
 * -- replaces ink's `borderStyle="round"` box for the action/confirm side
 * panel. A content line wider than the inner width wraps onto additional
 * rows (display-width based, grapheme-safe) rather than being clipped --
 * losing the tail of a branch name or the "?" off a confirm prompt left the
 * user unable to tell what they were about to delete (astra/Fable-reported
 * regression from the ink version, which wrapped the same way).
 */
export const wrapInBox = (content: readonly StyledLine[], width: number): StyledLine[] => {
  const innerWidth = Math.max(0, width - BOX_BORDER_WIDTH - BOX_PADDING_TOTAL);
  const horizontal = BOX_HORIZONTAL.repeat(Math.max(0, width - BOX_BORDER_WIDTH));
  const pad = " ".repeat(BOX_PADDING);
  const top: StyledLine = [{ text: `${BOX_TOP_LEFT}${horizontal}${BOX_TOP_RIGHT}` }];
  const bottom: StyledLine = [{ text: `${BOX_BOTTOM_LEFT}${horizontal}${BOX_BOTTOM_RIGHT}` }];
  const boxRow = (row: StyledLine): StyledLine => {
    const gap = " ".repeat(Math.max(0, innerWidth - lineWidth(row)));
    return [{ text: `${BOX_VERTICAL}${pad}` }, ...row, { text: `${gap}${pad}${BOX_VERTICAL}` }];
  };
  const middle = content.flatMap((line): StyledLine[] => {
    const rows = lineWidth(line) <= innerWidth ? [line] : wrapLineToWidth(line, innerWidth);
    return rows.map((row) => boxRow(row));
  });
  return [top, ...middle, bottom];
};

const ELLIPSIS = "…";

/**
 * Truncates one line to at most `width` display columns, replacing any cut
 * content with an ellipsis -- never splitting a grapheme cluster.
 * Exported as a last-resort safety net picker.ts applies to every rendered
 * line: the row/footer builders already try to fit content within the
 * known terminal width (picker-layout.ts's candidateRowPathMaxLength/
 * candidateRowBranchWidth, picker-side-by-side.ts's footerHintForWidth),
 * but this guarantees no line can ever exceed the terminal's actual width
 * regardless of what produced it (astra/Fable-reported: an overflowing
 * line gets wrapped by the terminal itself, which throws off
 * picker-viewport.ts's rowBudget estimate and can scroll the screen).
 */
export const truncateLineToWidth = (line: StyledLine, width: number): StyledLine => {
  if (lineWidth(line) <= width) {
    return line;
  }
  const budget = Math.max(0, width - displayWidth(ELLIPSIS));
  const kept: StyledGrapheme[] = [];
  let usedWidth = 0;
  for (const char of flattenToGraphemes(line)) {
    const charWidth = displayWidth(char.text);
    if (usedWidth + charWidth > budget) {
      break;
    }
    kept.push(char);
    usedWidth += charWidth;
  }
  return [...groupIntoSpans(kept), { text: ELLIPSIS }];
};

/** Builds one full frame (cursor-home + clear-to-end-of-screen + content), ready to write in a single call. */
export const buildFrame = (input: FrameInput): string => {
  const { left, right, stacked, colorEnabled } = input;
  const lines = buildFrameLines(left, right, stacked, colorEnabled);
  return `${CURSOR_HOME}${CLEAR_TO_END}${lines.join("\r\n")}`;
};

const buildFrameLines = (
  left: readonly StyledLine[],
  right: readonly StyledLine[] | null,
  stacked: boolean,
  colorEnabled: boolean,
): string[] => {
  if (right === null) {
    return left.map((line) => renderLine(line, colorEnabled));
  }
  if (stacked) {
    return [...left, ...right].map((line) => renderLine(line, colorEnabled));
  }
  return buildSideBySide(left, right, colorEnabled);
};

import { displayWidth } from "../domain/display-width.ts";

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

const GUTTER = "  ";

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

const renderPlain = (line: StyledLine): string => line.map((span) => span.text).join("");

/**
 * Wraps `content` in a round-cornered border, `width` display columns wide
 * -- replaces ink's `borderStyle="round"` box for the action/confirm side
 * panel. A content line wider than the inner width is clipped to plain text
 * (losing its styling) rather than overflowing the border; this only
 * happens for pathologically long candidate/branch names, never for the
 * fixed panel copy.
 */
export const wrapInBox = (content: readonly StyledLine[], width: number): StyledLine[] => {
  const innerWidth = Math.max(0, width - BOX_BORDER_WIDTH - BOX_PADDING_TOTAL);
  const horizontal = BOX_HORIZONTAL.repeat(Math.max(0, width - BOX_BORDER_WIDTH));
  const pad = " ".repeat(BOX_PADDING);
  const top: StyledLine = [{ text: `${BOX_TOP_LEFT}${horizontal}${BOX_TOP_RIGHT}` }];
  const bottom: StyledLine = [{ text: `${BOX_BOTTOM_LEFT}${horizontal}${BOX_BOTTOM_RIGHT}` }];
  const middle = content.map((line): StyledLine => {
    const fits = lineWidth(line) <= innerWidth;
    const body: StyledLine = fits ? line : [{ text: renderPlain(line).slice(0, innerWidth) }];
    const gap = " ".repeat(Math.max(0, innerWidth - lineWidth(body)));
    return [{ text: `${BOX_VERTICAL}${pad}` }, ...body, { text: `${gap}${pad}${BOX_VERTICAL}` }];
  });
  return [top, ...middle, bottom];
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

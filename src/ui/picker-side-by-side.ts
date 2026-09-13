import { displayWidth, truncateToWidth } from "../domain/display-width.ts";
import { GUTTER } from "./picker-frame.ts";
import { KIND_COLUMN_WIDTH, MAX_BRANCH_COLUMN_WIDTH, MAX_PATH_LENGTH } from "./picker-layout.ts";
import { SIDE_PANEL_WIDTH } from "./side-panel.ts";

/** Non-column, always-present chrome in a rendered candidate row: the 2-column "❯ "/"  " selection marker, the 1-column status marker, a space after it, the 2-column gutter between the branch and kind columns, and a space before the path -- mirrors picker.ts's candidateRowLine format string exactly. */
const SELECTION_MARKER_WIDTH = 2;
const STATUS_MARKER_WIDTH = 1;
const STATUS_MARKER_GAP_WIDTH = 1;
const BRANCH_KIND_GUTTER_WIDTH = 2;
const KIND_PATH_GAP_WIDTH = 1;
const CANDIDATE_ROW_CHROME_WIDTH =
  SELECTION_MARKER_WIDTH +
  STATUS_MARKER_WIDTH +
  STATUS_MARKER_GAP_WIDTH +
  BRANCH_KIND_GUTTER_WIDTH +
  KIND_PATH_GAP_WIDTH;

/**
 * Whether the picker's side panel (action panel / confirm) fits beside the
 * list, or must fall back to stacking below it -- split out of
 * picker-layout.ts (which stays focused on row content) to keep that file
 * under the lint line-count limit. `isNarrowTerminal` used to compare
 * `columns` against a fixed 60-column threshold, which badly underestimated
 * the list column's own content width (a candidate row easily reaches
 * 75+ columns), so side-by-side got picked even when it didn't actually
 * fit and the resulting row wrapped in the terminal (Fable-reported
 * regression from the ink version, which never let this happen).
 *
 * The threshold is *not* sized off the full candidate row width
 * (MAX_CANDIDATE_ROW_WIDTH, which assumes the full MAX_PATH_LENGTH path
 * budget) or the full-length footer hint: both degrade gracefully when
 * squeezed (constrainRowColumnWidths shrinks the path first; the footer
 * has a short fallback, footerHintForWidth below), so neither should
 * decide whether side-by-side is even attempted. Sizing the threshold off
 * the 104-column footer instead needlessly forced 80-139 column terminals
 * (most real terminals) into stacked mode -- a Fable-reported regression,
 * since the ink version went side-by-side around 100 columns. Requiring
 * only half the path budget (rather than all of it) plus the row's fixed
 * columns keeps the threshold in that same ballpark.
 */
const HALF_DIVISOR = 2;
const MIN_PATH_DISPLAY_LENGTH = Math.ceil(MAX_PATH_LENGTH / HALF_DIVISOR);

export const MAX_CANDIDATE_ROW_WIDTH =
  CANDIDATE_ROW_CHROME_WIDTH + MAX_BRANCH_COLUMN_WIDTH + KIND_COLUMN_WIDTH + MAX_PATH_LENGTH;

export const MIN_SIDE_BY_SIDE_WIDTH =
  CANDIDATE_ROW_CHROME_WIDTH +
  MAX_BRANCH_COLUMN_WIDTH +
  KIND_COLUMN_WIDTH +
  MIN_PATH_DISPLAY_LENGTH +
  displayWidth(GUTTER) +
  SIDE_PANEL_WIDTH;

export const isNarrowTerminal = (columns: number): boolean => columns < MIN_SIDE_BY_SIDE_WIDTH;

/** The picker's two footer key-hint lines -- kept here (rather than in picker.ts) so footerHintForWidth (below) can pick between this and its short fallback. */
export const LIST_FOOTER_HINT =
  "Tab/→/Ctrl+L actions · Ctrl+X delete · Ctrl+R switch root · ↑↓/Ctrl+P,N,K,J move · Enter cd · Esc cancel";
export const PANEL_FOOTER_HINT =
  "↑↓/Ctrl+P,N,K,J move · Enter run · c/d/r shortcuts · Esc/Tab/←/Ctrl+H close";

/**
 * Shrinks a candidate row's branch/path column widths to fit `maxRowWidth`,
 * squeezing the path column first (down to nothing) and only then the
 * branch column -- a full-width row was previously built at its natural
 * (candidate-driven) width regardless of the terminal, so it could exceed
 * the terminal's actual width and get line-wrapped there, throwing off
 * picker-viewport.ts's rowBudget row-count estimate (astra/Fable-reported).
 * `rawBranchWidth` is the natural width (picker-layout.ts's
 * branchColumnWidth); the kind column and the row's fixed chrome always
 * keep their space since neither shrinks.
 */
export const constrainRowColumnWidths = (
  rawBranchWidth: number,
  maxRowWidth: number,
): { readonly branchWidth: number; readonly pathMaxLength: number } => {
  const availableForBranchAndPath = Math.max(
    0,
    maxRowWidth - CANDIDATE_ROW_CHROME_WIDTH - KIND_COLUMN_WIDTH,
  );
  const branchWidth = Math.min(rawBranchWidth, availableForBranchAndPath);
  const pathMaxLength = Math.max(
    0,
    Math.min(MAX_PATH_LENGTH, availableForBranchAndPath - branchWidth),
  );
  return { branchWidth, pathMaxLength };
};

/**
 * Shortened footer hints, kept to just the essentials (move / confirm /
 * cancel) for terminals too narrow for the full hint -- a narrow terminal
 * losing every hint down to the sub-second-truncated tail end (astra/Fable-
 * reported: a 104-column footer overflowing an 80-column terminal) is worse
 * than dropping the less-essential shortcuts (Tab/actions, Ctrl+X delete,
 * etc.), since knowing how to move, confirm, and get out (Esc) is what
 * actually matters when the terminal is this tight.
 */
const SHORT_LIST_FOOTER_HINT = "↑↓ move · Enter cd · Esc cancel";
const SHORT_PANEL_FOOTER_HINT = "↑↓ move · Enter run · Esc close";

/**
 * Picks the widest footer hint variant that still fits `width`: the full
 * hint, then the short one, then (as a last-resort safety net for a truly
 * tiny terminal) the short one truncated to width. Never returns a string
 * wider than `width`.
 */
export const footerHintForWidth = (kind: "list" | "panel", width: number): string => {
  const full = kind === "list" ? LIST_FOOTER_HINT : PANEL_FOOTER_HINT;
  const short = kind === "list" ? SHORT_LIST_FOOTER_HINT : SHORT_PANEL_FOOTER_HINT;
  if (displayWidth(full) <= width) {
    return full;
  }
  if (displayWidth(short) <= width) {
    return short;
  }
  return truncateToWidth(short, width);
};

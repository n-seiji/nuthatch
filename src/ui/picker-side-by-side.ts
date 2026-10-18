import { displayWidth, truncateToWidth } from "../domain/display-width.ts";
import { GUTTER } from "./picker-frame.ts";
import { KIND_COLUMN_WIDTH, MAX_BRANCH_COLUMN_WIDTH, MAX_PATH_LENGTH } from "./picker-layout.ts";
import { SIDE_PANEL_WIDTH } from "./side-panel.ts";

/** Fixed chrome in a rendered candidate row; mirrors picker-render.ts's candidateRowLine format string: selection marker, status marker + space, branch/kind gutter, space before the path. */
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
 * Whether the side panel fits beside the list or must stack below it.
 *
 * The threshold is sized off the fixed row chrome, the branch and kind
 * columns, half the path budget, the gutter and the panel -- not the full
 * candidate row width or the full footer hint, which both degrade
 * gracefully when squeezed (constrainRowColumnWidths shrinks the path
 * first; footerHintForWidth has a short fallback). Half the path budget
 * keeps side-by-side available from about 100 columns; the full budget
 * would stack every 80-139 column terminal.
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

/** The picker's two footer key-hint lines -- kept here (rather than in picker-render.ts) so footerHintForWidth (below) can pick between this and its short fallback. */
const LIST_FOOTER_HINT =
  "Tab/→/Ctrl+L actions · Ctrl+X delete · Ctrl+R switch root · ↑↓/Ctrl+P,N,K,J move · Enter cd · Esc cancel";
const PANEL_FOOTER_HINT =
  "↑↓/Ctrl+P,N,K,J move · Enter run · c/d/r shortcuts · Esc/Tab/←/Ctrl+H close";

/**
 * Shrinks a candidate row's branch/path column widths to fit `maxRowWidth`,
 * squeezing the path column first (down to nothing) and only then the
 * branch column, so a row never exceeds the terminal width and wraps
 * (which would break picker-viewport.ts's rowBudget row count).
 * `rawBranchWidth` is the natural width (picker-layout.ts's
 * branchColumnWidth); the kind column and the row's fixed chrome never shrink.
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

/** Essentials only (move / confirm / cancel), for terminals too narrow for the full hint. */
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

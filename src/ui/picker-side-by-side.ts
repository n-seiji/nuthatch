import { displayWidth } from "../domain/display-width.ts";
import { GUTTER } from "./picker-frame.ts";
import { KIND_COLUMN_WIDTH, MAX_BRANCH_COLUMN_WIDTH, MAX_PATH_LENGTH } from "./picker-layout.ts";
import { SIDE_PANEL_WIDTH } from "./side-panel.ts";

/**
 * Whether the picker's side panel (action panel / confirm) fits beside the
 * list, or must fall back to stacking below it -- split out of
 * picker-layout.ts (which stays focused on row content) to keep that file
 * under the lint line-count limit. `isNarrowTerminal` used to compare
 * `columns` against a fixed 60-column threshold, which badly underestimated
 * the list column's own content width (a candidate row, or especially the
 * footer key-hint line, easily reaches 75-100+ columns), so side-by-side
 * got picked even when it didn't actually fit and the resulting row wrapped
 * in the terminal (Fable-reported regression from the ink version, which
 * never let this happen). The threshold is now computed from the list's
 * actual worst-case content width plus the gutter and panel width.
 */

/** The picker's two footer key-hint lines -- kept here (rather than in picker.ts) so MIN_SIDE_BY_SIDE_WIDTH can size itself off their real width. */
export const LIST_FOOTER_HINT =
  "Tab/→/Ctrl+L actions · Ctrl+X delete · Ctrl+R switch root · ↑↓/Ctrl+P,N,K,J move · Enter cd · Esc cancel";
export const PANEL_FOOTER_HINT =
  "↑↓/Ctrl+P,N,K,J move · Enter run · c/d/r shortcuts · Esc/Tab/←/Ctrl+H close";

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

/** Upper bound on a rendered candidate row's display width (branch/path columns capped at their max, kind column at its fixed width). */
export const MAX_CANDIDATE_ROW_WIDTH =
  CANDIDATE_ROW_CHROME_WIDTH + MAX_BRANCH_COLUMN_WIDTH + KIND_COLUMN_WIDTH + MAX_PATH_LENGTH;

/** Below this terminal width, the side-by-side panel doesn't fit next to the list (a candidate row or a footer hint would wrap) -- picker.ts falls back to stacking the panel under the list instead. */
export const MIN_SIDE_BY_SIDE_WIDTH =
  Math.max(
    displayWidth(LIST_FOOTER_HINT),
    displayWidth(PANEL_FOOTER_HINT),
    MAX_CANDIDATE_ROW_WIDTH,
  ) +
  displayWidth(GUTTER) +
  SIDE_PANEL_WIDTH;

export const isNarrowTerminal = (columns: number): boolean => columns < MIN_SIDE_BY_SIDE_WIDTH;

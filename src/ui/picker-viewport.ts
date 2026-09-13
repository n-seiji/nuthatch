/**
 * Picker viewport math: which slice of the (filtered, sorted) candidate
 * list actually gets drawn, given the terminal's height.
 *
 * Bug this replaces (astra-reported): the picker always rendered the first
 * `MAX_VISIBLE_ROWS` candidates (picker.ts used to do
 * `filtered.slice(0, MAX_VISIBLE_ROWS)`), but the cursor could move across
 * the *entire* filtered list — `clampedIndex` in picker-store.ts is an
 * index into `filtered`, unbounded by what's on screen. Once the cursor
 * moved past row 15, nothing was highlighted, but Enter/Ctrl+X/Ctrl+R still
 * ran against `filtered[clampedIndex]` — a candidate the user couldn't
 * even see. This module makes "which candidates are visible" a function of
 * the current selection, not a fixed head slice, so the two can never
 * disagree: the window always contains `selectedIndex`.
 *
 * Kept pure and framework-free (no ink/process.stdout) so it's unit
 * testable without a real terminal — see picker-viewport.test.ts.
 */

/** Assumed terminal height when it can't be measured (e.g. stream.rows is undefined — not a TTY, or a very early resize event). Matches common defaults (macOS Terminal.app, most CI TTYs default near 24). */
export const DEFAULT_TERMINAL_HEIGHT = 24;

/** Never show fewer candidate rows than this, even in a tiny terminal — a window this small still gives the user a usable list instead of nothing. */
export const MIN_VISIBLE_CANDIDATE_ROWS = 3;

/**
 * Rows always spent on picker chrome, regardless of candidate count: the
 * "hop: <query>" line, the legend line, and the footer hint line. Section
 * headers (WORKTREES / BRANCHES) are budgeted separately (see
 * `SECTION_HEADER_ROWS`) since whether they appear depends on the
 * candidates in view.
 */
const BASE_CHROME_ROWS = 3;

/**
 * Worst case both section headers (WORKTREES and BRANCHES) are visible at
 * once. Reserving for both keeps the budget correct whether or not a given
 * window actually straddles both sections — under-reserving would let the
 * list overflow the terminal when it does.
 */
const SECTION_HEADER_ROWS = 2;

/** One row reserved for "... and N more" above the window, one below — reserved unconditionally so the budget doesn't shrink/grow as scrolling crosses the edges. */
const HIDDEN_COUNT_INDICATOR_ROWS = 2;

export interface RowBudgetInputs {
  /** Terminal height in rows; falls back to DEFAULT_TERMINAL_HEIGHT when unavailable. */
  readonly terminalHeight: number;
  /**
   * How many rows the side panel/confirm box actually occupies when it's
   * stacked below the list instead of beside it (narrow terminals — see
   * picker-layout.ts's isNarrowTerminal); 0 when there's no panel or it
   * sits beside the list instead. Pass the real rendered row count (the
   * panel's content wraps onto extra rows for long branch names/errors —
   * see picker-frame.ts's wrapInBox), not an estimate: a fixed guess here
   * previously under-reserved for a wrapped panel, pushing the frame past
   * the terminal height and scrolling the screen (astra/Fable-reported).
   */
  readonly stackedPanelRows: number;
}

/** How many candidate rows the list can show, after reserving space for chrome (and the stacked panel, if any). Never below MIN_VISIBLE_CANDIDATE_ROWS. */
export const rowBudget = ({ terminalHeight, stackedPanelRows }: RowBudgetInputs): number => {
  const reserved =
    BASE_CHROME_ROWS + SECTION_HEADER_ROWS + HIDDEN_COUNT_INDICATOR_ROWS + stackedPanelRows;
  return Math.max(MIN_VISIBLE_CANDIDATE_ROWS, terminalHeight - reserved);
};

export interface Viewport {
  /** Index into the filtered candidate list of the first visible candidate (inclusive). */
  readonly start: number;
  /** Index into the filtered candidate list one past the last visible candidate (exclusive). */
  readonly end: number;
  readonly hiddenAbove: number;
  readonly hiddenBelow: number;
}

/**
 * Computes the visible window [start, end) over `total` candidates such
 * that `selectedIndex` always falls inside it. Recomputed fresh from
 * (total, selectedIndex, budget) on every call — no persisted scroll
 * offset — so it's a pure function of the current selection: centers the
 * window on the selection when there's room to, then clamps to
 * [0, total) at either edge so the window never runs past the list.
 */
export const computeViewport = (total: number, selectedIndex: number, budget: number): Viewport => {
  if (total <= budget) {
    return { start: 0, end: total, hiddenAbove: 0, hiddenBelow: 0 };
  }
  const HALF_DIVISOR = 2;
  const half = Math.floor(budget / HALF_DIVISOR);
  const maxStart = total - budget;
  const start = Math.min(maxStart, Math.max(0, selectedIndex - half));
  const end = start + budget;
  return { start, end, hiddenAbove: start, hiddenBelow: total - end };
};

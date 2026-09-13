/**
 * Terminal display-width utilities: how many terminal columns a string
 * takes up, as opposed to its UTF-16 `.length` or its number of grapheme
 * clusters. picker-layout.ts's column padding and path truncation used
 * `.length`/`.slice`/`.padEnd` directly, which misaligns as soon as a
 * branch name or path contains a fullwidth character (CJK, fullwidth
 * forms), a combining mark, or an emoji — ink absorbed some of that when
 * it owned layout, but a self-drawn renderer can't rely on that. Kept in
 * domain/ (pure, no dependencies) so it's unit-testable without a
 * terminal — see display-width.test.ts.
 *
 * Grapheme segmentation uses the built-in `Intl.Segmenter` rather than a
 * hand-rolled one, so multi-codepoint clusters (emoji ZWJ sequences,
 * base+combining-mark pairs, regional indicator flag pairs) are never
 * split mid-cluster.
 */

const WIDTH_ZERO = 0;
const WIDTH_NARROW = 1;
const WIDTH_WIDE = 2;

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Zero-width joiner and the two emoji variation selectors — never occupy a column on their own. */
const ZERO_WIDTH_JOINER = 0x20_0d;
const VARIATION_SELECTOR_TEXT = 0xfe_0e;
const VARIATION_SELECTOR_EMOJI = 0xfe_0f;
const ZERO_WIDTH_CODE_POINTS = new Set([
  ZERO_WIDTH_JOINER,
  VARIATION_SELECTOR_TEXT,
  VARIATION_SELECTOR_EMOJI,
]);

/** Combining marks (Mn/Me general categories) — attach to the preceding base without adding width. */
const isCombiningMark = (codePoint: number): boolean =>
  /\p{M}/u.test(String.fromCodePoint(codePoint));

const HANGUL_JAMO_START = 0x11_00;
const HANGUL_JAMO_END = 0x11_5f;
const CJK_RADICALS_START = 0x2e_80;
const CJK_SYMBOLS_END = 0x30_3e;
const HIRAGANA_START = 0x30_41;
const CJK_COMPATIBILITY_END = 0x33_ff;
const CJK_EXT_A_START = 0x34_00;
const CJK_EXT_A_END = 0x4d_bf;
const CJK_UNIFIED_START = 0x4e_00;
const CJK_UNIFIED_END = 0x9f_ff;
const YI_SYLLABLES_START = 0xa0_00;
const YI_SYLLABLES_END = 0xa4_cf;
const HANGUL_SYLLABLES_START = 0xac_00;
const HANGUL_SYLLABLES_END = 0xd7_a3;
const CJK_COMPAT_IDEOGRAPHS_START = 0xf9_00;
const CJK_COMPAT_IDEOGRAPHS_END = 0xfa_ff;
const CJK_COMPAT_FORMS_START = 0xfe_30;
const CJK_COMPAT_FORMS_END = 0xfe_4f;
const FULLWIDTH_FORMS_START = 0xff_00;
const FULLWIDTH_FORMS_END = 0xff_60;
const FULLWIDTH_SIGNS_START = 0xff_e0;
const FULLWIDTH_SIGNS_END = 0xff_e6;
const EMOJI_MISC_START = 0x1_f3_00;
const EMOJI_MISC_END = 0x1_f6_4f;
const EMOJI_TRANSPORT_START = 0x1_f6_80;
const EMOJI_TRANSPORT_END = 0x1_f9_ff;
const CJK_EXT_B_START = 0x2_00_00;
const CJK_EXT_B_END = 0x3_ff_fd;

/**
 * East Asian Wide/Fullwidth ranges (Unicode East_Asian_Width=W/F), plus the
 * common emoji blocks, which terminals render as two columns. Not
 * exhaustive of every Unicode wide range, but covers CJK ideographs,
 * hiragana/katakana, hangul, fullwidth forms, and emoji — the cases that
 * actually show up in branch names, paths, and status glyphs.
 */
const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [HANGUL_JAMO_START, HANGUL_JAMO_END],
  [CJK_RADICALS_START, CJK_SYMBOLS_END],
  [HIRAGANA_START, CJK_COMPATIBILITY_END],
  [CJK_EXT_A_START, CJK_EXT_A_END],
  [CJK_UNIFIED_START, CJK_UNIFIED_END],
  [YI_SYLLABLES_START, YI_SYLLABLES_END],
  [HANGUL_SYLLABLES_START, HANGUL_SYLLABLES_END],
  [CJK_COMPAT_IDEOGRAPHS_START, CJK_COMPAT_IDEOGRAPHS_END],
  [CJK_COMPAT_FORMS_START, CJK_COMPAT_FORMS_END],
  [FULLWIDTH_FORMS_START, FULLWIDTH_FORMS_END],
  [FULLWIDTH_SIGNS_START, FULLWIDTH_SIGNS_END],
  [EMOJI_MISC_START, EMOJI_MISC_END],
  [EMOJI_TRANSPORT_START, EMOJI_TRANSPORT_END],
  [CJK_EXT_B_START, CJK_EXT_B_END],
];

const isWide = (codePoint: number): boolean =>
  WIDE_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end);

/** Display width of a single codepoint: 0 (combining/zero-width), 1 (narrow), or 2 (wide). */
const codePointWidth = (
  codePoint: number,
): typeof WIDTH_ZERO | typeof WIDTH_NARROW | typeof WIDTH_WIDE => {
  if (ZERO_WIDTH_CODE_POINTS.has(codePoint) || isCombiningMark(codePoint)) {
    return WIDTH_ZERO;
  }
  return isWide(codePoint) ? WIDTH_WIDE : WIDTH_NARROW;
};

/** Width of one grapheme cluster: the widest codepoint it contains (a ZWJ emoji sequence reads as one wide blob; a base+combining-mark pair reads as the base's width). */
const graphemeWidth = (grapheme: string): number => {
  const codePoints = Array.from(grapheme, (char) => char.codePointAt(0)).filter(
    (codePoint): codePoint is number => codePoint !== undefined,
  );
  return codePoints.reduce(
    (max, codePoint) => Math.max(max, codePointWidth(codePoint)),
    WIDTH_ZERO,
  );
};

/** Splits a string into grapheme clusters — the unit every function here operates on so a cluster is never cut in half. */
export const graphemes = (value: string): string[] =>
  Array.from(segmenter.segment(value), (entry) => entry.segment);

/** Terminal column width of `value` — sum of each grapheme cluster's width. */
export const displayWidth = (value: string): number =>
  graphemes(value).reduce((total, grapheme) => total + graphemeWidth(grapheme), WIDTH_ZERO);

/** Pads `value` with trailing spaces until it reaches `width` display columns. Already-wide-enough strings pass through unchanged (never truncates). */
export const padToWidth = (value: string, width: number): string => {
  const current = displayWidth(value);
  return current >= width ? value : value + " ".repeat(width - current);
};

const DEFAULT_ELLIPSIS = "…";

/**
 * Truncates `value` to at most `width` display columns, replacing any cut
 * content with `ellipsis` (default "…", itself 1 column wide) — never
 * splitting a grapheme cluster. Keeps whole clusters from the front,
 * dropping the last one that would overflow along with everything after
 * it. If even the ellipsis alone doesn't fit, returns as many
 * ellipsis-width columns as fit (i.e. "" once width is 0).
 */
export const truncateToWidth = (
  value: string,
  width: number,
  ellipsis = DEFAULT_ELLIPSIS,
): string => {
  if (displayWidth(value) <= width) {
    return value;
  }
  const budget = width - displayWidth(ellipsis);
  if (budget < WIDTH_ZERO) {
    return "";
  }
  let kept = "";
  let usedWidth = WIDTH_ZERO;
  for (const grapheme of graphemes(value)) {
    const nextWidth = usedWidth + graphemeWidth(grapheme);
    if (nextWidth > budget) {
      break;
    }
    kept += grapheme;
    usedWidth = nextWidth;
  }
  return kept + ellipsis;
};

/**
 * Truncates `value` to at most `width` display columns from the front,
 * keeping the *tail* instead (used for paths, e.g.
 * "…ghq/github.com/x/repo" over "…epo") — never splitting a grapheme
 * cluster. Mirrors truncateToWidth's overflow/ellipsis-only-fits rules.
 */
export const truncateToWidthKeepingTail = (
  value: string,
  width: number,
  ellipsis = DEFAULT_ELLIPSIS,
): string => {
  if (displayWidth(value) <= width) {
    return value;
  }
  const budget = width - displayWidth(ellipsis);
  if (budget < WIDTH_ZERO) {
    return "";
  }
  let kept = "";
  let usedWidth = WIDTH_ZERO;
  for (const grapheme of graphemes(value).toReversed()) {
    const nextWidth = usedWidth + graphemeWidth(grapheme);
    if (nextWidth > budget) {
      break;
    }
    kept = grapheme + kept;
    usedWidth = nextWidth;
  }
  return ellipsis + kept;
};

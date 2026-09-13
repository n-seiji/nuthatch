import { candidateBranchLabel, type PickCandidate } from "../domain/candidates.ts";
import {
  displayWidth,
  padToWidth,
  truncateToWidth,
  truncateToWidthKeepingTail,
} from "../domain/display-width.ts";

// Re-exported so picker.ts (already at its import-count budget) doesn't
// Need a separate import source for viewport math — picker-viewport.ts
// Stays its own module for testability, this is just a re-export.
export { computeViewport, DEFAULT_TERMINAL_HEIGHT, rowBudget } from "./picker-viewport.ts";

/**
 * Pure layout: turns the flat candidate list into the two-section, aligned
 * display the picker renders (WORKTREES / BRANCHES, status markers, padded
 * columns, shortened paths). Kept free of ink/react so it's unit-testable
 * without rendering — see picker-layout.test.ts.
 */

/** Exported for picker-side-by-side.ts's MAX_CANDIDATE_ROW_WIDTH -- kept here since it's this module's own column-width budget. */
export const MAX_PATH_LENGTH = 40;
/** Exported for picker-side-by-side.ts's MAX_CANDIDATE_ROW_WIDTH -- see MAX_PATH_LENGTH above. */
export const MAX_BRANCH_COLUMN_WIDTH = 24;

export const LEGEND_TEXT = "●=dirty ○=clean +=not created";

const WORKTREE_KIND_LABELS: Record<"root" | "managed" | "external", string> = {
  root: "root",
  managed: "managed",
  external: "ext",
};

const CREATABLE_SOURCE_LABELS: Record<"local" | "remote", string> = {
  local: "local",
  remote: "remote",
};

/** ● dirty / ○ clean / space (dirty status unknown) / + not yet created. */
export const statusMarker = (candidate: PickCandidate): string => {
  if (candidate.kind === "creatable") {
    return "+";
  }
  if (candidate.dirty === null) {
    return " ";
  }
  return candidate.dirty ? "●" : "○";
};

export const candidateKindLabel = (candidate: PickCandidate): string =>
  candidate.kind === "worktree"
    ? WORKTREE_KIND_LABELS[candidate.worktree.kind]
    : CREATABLE_SOURCE_LABELS[candidate.source];

const isWorktreeCandidate = (
  candidate: PickCandidate,
): candidate is Extract<PickCandidate, { kind: "worktree" }> => candidate.kind === "worktree";

const isCreatableCandidate = (
  candidate: PickCandidate,
): candidate is Extract<PickCandidate, { kind: "creatable" }> => candidate.kind === "creatable";

const WORKTREE_KIND_ORDER: Record<"root" | "managed" | "external", number> = {
  root: 0,
  managed: 1,
  external: 2,
};

const CREATABLE_SOURCE_ORDER: Record<"local" | "remote", number> = {
  local: 0,
  remote: 1,
};

const compareByBranchLabel = (a: PickCandidate, b: PickCandidate): number =>
  candidateBranchLabel(a).localeCompare(candidateBranchLabel(b));

/** 0 for a normal branch, 1 for detached HEAD — sorts detached worktrees to the end of their kind group. */
const detachedRank = (candidate: Extract<PickCandidate, { kind: "worktree" }>): number =>
  candidate.worktree.branch === null ? 1 : 0;

const compareWorktreeCandidates = (
  a: Extract<PickCandidate, { kind: "worktree" }>,
  b: Extract<PickCandidate, { kind: "worktree" }>,
): number => {
  const kindDiff = WORKTREE_KIND_ORDER[a.worktree.kind] - WORKTREE_KIND_ORDER[b.worktree.kind];
  if (kindDiff !== 0) {
    return kindDiff;
  }
  const detachedDiff = detachedRank(a) - detachedRank(b);
  return detachedDiff === 0 ? compareByBranchLabel(a, b) : detachedDiff;
};

const compareCreatableCandidates = (
  a: Extract<PickCandidate, { kind: "creatable" }>,
  b: Extract<PickCandidate, { kind: "creatable" }>,
): number => {
  const sourceDiff = CREATABLE_SOURCE_ORDER[a.source] - CREATABLE_SOURCE_ORDER[b.source];
  return sourceDiff === 0 ? compareByBranchLabel(a, b) : sourceDiff;
};

/**
 * Orders candidates the way the picker displays them: within WORKTREES,
 * root first, then managed, then external (branch name ascending within
 * each group, detached-HEAD worktrees last within their group since they
 * have no branch name to sort by); within BRANCHES, local before remote
 * (branch name ascending within each group). Worktree candidates always
 * sort before creatable ones — buildDisplayRows relies on that to group
 * them into sections. Applied after search filtering, so the order holds
 * under narrowing too.
 */
export const sortCandidatesForDisplay = (candidates: readonly PickCandidate[]): PickCandidate[] => [
  ...candidates
    .filter((candidate) => isWorktreeCandidate(candidate))
    .toSorted((a, b) => compareWorktreeCandidates(a, b)),
  ...candidates
    .filter((candidate) => isCreatableCandidate(candidate))
    .toSorted((a, b) => compareCreatableCandidates(a, b)),
];

/** Fixed column width for kindLabel — the longest label ("managed"/"remote") is 7 chars. */
export const KIND_COLUMN_WIDTH = Math.max(
  ...Object.values(WORKTREE_KIND_LABELS).map((label) => label.length),
  ...Object.values(CREATABLE_SOURCE_LABELS).map((label) => label.length),
);

/**
 * Replaces a leading `$HOME` with `~`, then truncates from the front
 * (keeping the tail) past maxLength *display columns* — not
 * `.length`/UTF-16 units, so a path containing wide characters (CJK
 * directory names, emoji) truncates at the same visual width a plain
 * ASCII path would, and never splits a grapheme cluster in half.
 */
export const shortenPath = (
  path: string,
  homeDir: string,
  maxLength: number = MAX_PATH_LENGTH,
): string => {
  const withTilde =
    homeDir.length > 0 && (path === homeDir || path.startsWith(`${homeDir}/`))
      ? `~${path.slice(homeDir.length)}`
      : path;
  return truncateToWidthKeepingTail(withTilde, maxLength);
};

const candidatePathLabel = (
  candidate: PickCandidate,
  homeDir: string,
  maxLength: number,
): string =>
  candidate.kind === "worktree" ? shortenPath(candidate.worktree.path, homeDir, maxLength) : "";

/** Longest branch label's display width, uncapped -- lets a wide terminal show branch names past MAX_BRANCH_COLUMN_WIDTH in full instead of clipping two long names sharing a prefix to the same text (Fable-reported). Used by picker.ts's terminal-aware constrainRowColumnWidths; branchColumnWidth (below) is for callers that don't know the terminal width. */
export const rawBranchColumnWidth = (candidates: readonly PickCandidate[]): number =>
  candidates.reduce(
    (max, candidate) => Math.max(max, displayWidth(candidateBranchLabel(candidate))),
    0,
  );

/** The branch/kind column width, capped at MAX_BRANCH_COLUMN_WIDTH. */
export const branchColumnWidth = (candidates: readonly PickCandidate[]): number =>
  Math.min(MAX_BRANCH_COLUMN_WIDTH, rawBranchColumnWidth(candidates));

/** Pads `label` to `width` *display columns* — a fullwidth branch name (CJK, emoji) still lines its column up with an ASCII one. */
export const padBranchLabel = (label: string, width: number): string => padToWidth(label, width);

export interface HeaderRow {
  readonly kind: "header";
  readonly label: string;
}

export interface CandidateRow {
  readonly kind: "candidate";
  /** Index into the candidate list this row was built from — used to match the picker's cursor position. */
  readonly index: number;
  /** Which section this row belongs to — lets the renderer dim BRANCHES rows so worktree vs. not-yet-created reads at a glance. */
  readonly section: "worktree" | "branch";
  readonly statusMarker: string;
  readonly branchLabel: string;
  readonly kindLabel: string;
  readonly pathLabel: string;
}

export type DisplayRow = HeaderRow | CandidateRow;

/**
 * Stable React key for a display row. Candidate rows key off their
 * candidate index (unique within the filtered list — two rows never share
 * one, even when their branch label collides, e.g. two detached-HEAD
 * worktrees both labeled "(detached)"). Header rows key off their label,
 * which is unique since a section renders at most one header.
 */
export const displayRowKey = (row: DisplayRow): string =>
  row.kind === "header" ? `header:${row.label}` : `candidate:${row.index}`;

interface ToCandidateRowOptions {
  readonly index: number;
  readonly section: "worktree" | "branch";
  readonly branchWidth: number;
  readonly pathMaxLength: number;
  readonly homeDir: string;
}

const toCandidateRow = (
  candidate: PickCandidate,
  options: ToCandidateRowOptions,
): CandidateRow => ({
  kind: "candidate",
  index: options.index,
  section: options.section,
  statusMarker: statusMarker(candidate),
  branchLabel: padBranchLabel(
    truncateToWidth(candidateBranchLabel(candidate), options.branchWidth),
    options.branchWidth,
  ),
  kindLabel: candidateKindLabel(candidate).padEnd(KIND_COLUMN_WIDTH, " "),
  pathLabel: candidatePathLabel(candidate, options.homeDir, options.pathMaxLength),
});

/**
 * Builds the rows the picker renders: a WORKTREES section followed by a
 * BRANCHES section. `index` on each candidate row is its position in
 * `candidates` plus `indexOffset` (unchanged as the picker's cursor
 * position) -- matters when `candidates` is a scrolled *window* rather
 * than the full filtered list (see picker-viewport.ts). `columnWidths`
 * overrides the natural (candidate-driven) branch/path column widths --
 * used by picker.ts to keep every row within the terminal's actual width
 * (see picker-side-by-side.ts's constrainRowColumnWidths); omitted, it
 * defaults to the unconstrained widths every existing caller/test expects.
 */
export const buildDisplayRows = (
  candidates: readonly PickCandidate[],
  homeDir: string,
  indexOffset = 0,
  columnWidths?: {
    readonly branchWidth: number;
    readonly pathMaxLength: number;
  },
): readonly DisplayRow[] => {
  const { branchWidth, pathMaxLength } = columnWidths ?? {
    branchWidth: branchColumnWidth(candidates),
    pathMaxLength: MAX_PATH_LENGTH,
  };
  const indexed = candidates.map((candidate, index) => ({
    candidate,
    index: index + indexOffset,
  }));
  const worktreeEntries = indexed.filter((entry) => isWorktreeCandidate(entry.candidate));
  const branchEntries = indexed.filter((entry) => isCreatableCandidate(entry.candidate));

  const rows: DisplayRow[] = [];
  if (worktreeEntries.length > 0) {
    rows.push({ kind: "header", label: "WORKTREES" });
    for (const entry of worktreeEntries) {
      rows.push(
        toCandidateRow(entry.candidate, {
          index: entry.index,
          section: "worktree",
          branchWidth,
          pathMaxLength,
          homeDir,
        }),
      );
    }
  }
  if (branchEntries.length > 0) {
    rows.push({ kind: "header", label: "BRANCHES — Enter creates a worktree" });
    for (const entry of branchEntries) {
      rows.push(
        toCandidateRow(entry.candidate, {
          index: entry.index,
          section: "branch",
          branchWidth,
          pathMaxLength,
          homeDir,
        }),
      );
    }
  }
  return rows;
};

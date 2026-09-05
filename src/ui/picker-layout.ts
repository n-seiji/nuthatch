import { candidateBranchLabel, type PickCandidate } from "../domain/candidates.ts";

/**
 * Pure layout: turns the flat candidate list into the two-section, aligned
 * display the picker renders (WORKTREES / BRANCHES, status markers, padded
 * columns, shortened paths). Kept free of ink/react so it's unit-testable
 * without rendering — see picker-layout.test.ts.
 */

const MAX_PATH_LENGTH = 40;
const MAX_BRANCH_COLUMN_WIDTH = 24;

export const LEGEND_TEXT = "●=dirty ○=clean +=未作成";

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

/** Replaces a leading `$HOME` with `~`, then truncates from the front (keeping the tail) past maxLength. */
export const shortenPath = (
  path: string,
  homeDir: string,
  maxLength: number = MAX_PATH_LENGTH,
): string => {
  const withTilde =
    homeDir.length > 0 && (path === homeDir || path.startsWith(`${homeDir}/`))
      ? `~${path.slice(homeDir.length)}`
      : path;
  if (withTilde.length <= maxLength) {
    return withTilde;
  }
  const ellipsis = "…";
  const keepLength = maxLength - ellipsis.length;
  return `${ellipsis}${withTilde.slice(withTilde.length - keepLength)}`;
};

const candidatePathLabel = (candidate: PickCandidate, homeDir: string): string =>
  candidate.kind === "worktree" ? shortenPath(candidate.worktree.path, homeDir) : "";

/** The branch/kind column width: the longest label in the list, capped so one long name can't blow out the layout. */
export const branchColumnWidth = (candidates: readonly PickCandidate[]): number =>
  candidates.reduce(
    (max, candidate) =>
      Math.min(MAX_BRANCH_COLUMN_WIDTH, Math.max(max, candidateBranchLabel(candidate).length)),
    0,
  );

export const padBranchLabel = (label: string, width: number): string =>
  label.length >= width ? label : label.padEnd(width, " ");

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
  branchLabel: padBranchLabel(candidateBranchLabel(candidate), options.branchWidth),
  kindLabel: candidateKindLabel(candidate).padEnd(KIND_COLUMN_WIDTH, " "),
  pathLabel: candidatePathLabel(candidate, options.homeDir),
});

/**
 * Builds the rows the picker renders: a WORKTREES section followed by a
 * BRANCHES section (not-yet-created branches). Groups by kind only —
 * ordering *within* each section (root first, local before remote, etc.)
 * is sortCandidatesForDisplay's job; callers should sort before calling
 * this (picker-controller.ts does, right after search filtering, so
 * narrowing never disturbs the order). A section with no members is
 * omitted entirely, header included — this naturally handles both "no
 * creatable branches at all" and "search query filtered a section empty".
 * `index` on each candidate row is its position in `candidates`, which the
 * picker uses unchanged as its cursor position (headers aren't selectable
 * and never consume an index).
 */
export const buildDisplayRows = (
  candidates: readonly PickCandidate[],
  homeDir: string,
): readonly DisplayRow[] => {
  const branchWidth = branchColumnWidth(candidates);
  const indexed = candidates.map((candidate, index) => ({ candidate, index }));
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
          homeDir,
        }),
      );
    }
  }
  if (branchEntries.length > 0) {
    rows.push({ kind: "header", label: "BRANCHES — Enter で worktree 作成" });
    for (const entry of branchEntries) {
      rows.push(
        toCandidateRow(entry.candidate, {
          index: entry.index,
          section: "branch",
          branchWidth,
          homeDir,
        }),
      );
    }
  }
  return rows;
};

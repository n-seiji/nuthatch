import { homedir } from "node:os";
import { isWithin } from "./domain/classify.ts";
import { displayWidth, padToWidth, truncateToWidth } from "./domain/display-width.ts";
import type { LsEntry } from "./domain/schema.ts";
import { compareWorktrees } from "./domain/worktree-order.ts";
import { colorEnabled } from "./ui/ansi.ts";
import { lineWidth, renderLine, type StyledLine, type StyledSpan } from "./ui/picker-frame.ts";
import { dirtyStyle, shortenPath, WORKTREE_KIND_STYLES } from "./ui/picker-layout.ts";

/**
 * `hop ls`'s human-readable table (the plain, non-`--json` output). A pure
 * function so the layout is unit-testable without a terminal; only
 * formatLsForStdout reads the terminal. cli.ts hands that to render.ts's
 * reportResult as the plain formatter, so `--json`, warnings, errors and the
 * exit code go through the same path as every other command.
 */

const SHORT_SHA_LENGTH = 7;
const MIN_PATH_WIDTH = 12;
const MAX_BRANCH_WIDTH = 32;
const COLUMN_GAP = "  ";
/** The "@ " current-worktree marker column. */
const MARKER_WIDTH = 2;

const branchCell = (entry: LsEntry): StyledSpan => {
  if (entry.branch !== null) {
    return { text: truncateToWidth(entry.branch, MAX_BRANCH_WIDTH), style: "bold" };
  }
  const sha = entry.head?.slice(0, SHORT_SHA_LENGTH) ?? "";
  return { text: entry.bare ? "(bare)" : `(detached ${sha})`, style: "dim" };
};

/** One state per row, most important first: a row that can't be acted on says why before "dirty" does. */
const stateCell = (entry: LsEntry): StyledSpan => {
  if (entry.prunable) {
    return { text: "✗ missing", style: "red" };
  }
  if (entry.locked) {
    return { text: "⊘ locked", style: "red" };
  }
  if (entry.bare) {
    return { text: "- bare", style: "dim" };
  }
  return { text: entry.dirty ? "● changes" : "✓ clean", style: dirtyStyle(entry.dirty) };
};

/** Commits ahead/behind the upstream: "↑2 ↓1", "=" when in sync, "-" without an upstream. */
const syncCells = (entry: LsEntry): StyledLine => {
  if (entry.ahead === null || entry.behind === null) {
    return [{ text: "-", style: "dim" }];
  }
  if (entry.ahead === 0 && entry.behind === 0) {
    return [{ text: "=", style: "dim" }];
  }
  const arrows: StyledSpan[] = [];
  if (entry.ahead > 0) {
    arrows.push({ text: `↑${entry.ahead}`, style: "green" });
  }
  if (entry.behind > 0) {
    arrows.push({ text: `↓${entry.behind}`, style: "red" });
  }
  return arrows.flatMap((span, index) => (index === 0 ? [span] : [{ text: " " }, span]));
};

interface Column {
  readonly header: string;
  readonly cells: (entry: LsEntry) => StyledLine;
}

const COLUMNS: readonly Column[] = [
  { header: "BRANCH", cells: (entry) => [branchCell(entry)] },
  { header: "STATE", cells: (entry) => [stateCell(entry)] },
  { header: "REMOTE", cells: syncCells },
  {
    header: "KIND",
    cells: (entry) => [{ text: entry.kind, style: WORKTREE_KIND_STYLES[entry.kind] }],
  },
];

/** The worktree `cwd` is in: the deepest path containing it (an external worktree can live inside root). */
const currentPath = (entries: readonly LsEntry[], cwd: string): string | null =>
  entries
    .filter((entry) => entry.path === cwd || isWithin(entry.path, cwd))
    .reduce<string | null>(
      (best, entry) => (best === null || entry.path.length > best.length ? entry.path : best),
      null,
    );

const summaryLine = (entries: readonly LsEntry[]): string => {
  const parts = [`${entries.length} worktree${entries.length === 1 ? "" : "s"}`];
  const counts: [number, string][] = [
    [entries.filter((entry) => entry.dirty).length, "with changes"],
    [entries.filter((entry) => (entry.ahead ?? 0) > 0).length, "ahead"],
    [entries.filter((entry) => entry.kind === "external").length, "external"],
    [entries.filter((entry) => entry.locked || entry.prunable).length, "locked or missing"],
  ];
  for (const [count, label] of counts) {
    if (count > 0) {
      parts.push(`${count} ${label}`);
    }
  }
  return parts.join(" · ");
};

export interface LsTableOptions {
  /** Emit SGR colors. */
  readonly color: boolean;
  /** Terminal width; the path column shrinks (keeping its tail) to fit. null = never truncate. */
  readonly width: number | null;
  readonly home: string;
  readonly cwd: string;
}

/** Pure: the full table (header, one line per worktree, summary), newline-terminated. */
export const formatLsTable = (entries: readonly LsEntry[], options: LsTableOptions): string => {
  const sorted = entries.toSorted(compareWorktrees);
  const current = currentPath(sorted, options.cwd);
  const columns = COLUMNS.map((column) => ({
    header: column.header,
    cells: column.cells,
    width: Math.max(
      displayWidth(column.header),
      ...sorted.map((entry) => lineWidth(column.cells(entry))),
    ),
  }));
  // "@ " + every column + its gap, then the path takes what is left.
  const fixedWidth =
    MARKER_WIDTH + columns.reduce((total, column) => total + column.width + COLUMN_GAP.length, 0);
  const pathWidth =
    options.width === null
      ? Number.POSITIVE_INFINITY
      : Math.max(MIN_PATH_WIDTH, options.width - fixedWidth);

  const header = columns.map((column) => padToWidth(column.header, column.width));
  const lines: StyledLine[] = [
    [{ text: `  ${header.join(COLUMN_GAP)}${COLUMN_GAP}PATH`, style: "dim" }],
  ];
  for (const entry of sorted) {
    const line: StyledSpan[] = [
      entry.path === current ? { text: "@", style: "green" } : { text: " " },
      { text: " " },
    ];
    for (const column of columns) {
      const cells = column.cells(entry);
      const gap = " ".repeat(Math.max(0, column.width - lineWidth(cells))) + COLUMN_GAP;
      line.push(...cells, { text: gap });
    }
    line.push({ text: shortenPath(entry.path, options.home, pathWidth), style: "dim" });
    lines.push(line);
  }
  lines.push([], [{ text: summaryLine(sorted), style: "dim" }]);
  return `${lines.map((line) => renderLine(line, options.color)).join("\n")}\n`;
};

/** The table as it should look on this process's stdout: colors and width only when it is a terminal. */
export const formatLsForStdout = (entries: readonly LsEntry[]): string => {
  const { columns } = process.stdout;
  return formatLsTable(entries, {
    color: colorEnabled(process.stdout),
    width: columns > 0 ? columns : null,
    home: homedir(),
    cwd: process.cwd(),
  });
};

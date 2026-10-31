import {
  displayWidth,
  padToWidth,
  truncateToWidth,
  truncateToWidthKeepingTail,
} from "./domain/display-width.ts";
import { SGR, SGR_RESET } from "./domain/ansi.ts";
import { isWithinOrSelf } from "./domain/classify.ts";
import { shortenHome } from "./domain/posix-path.ts";
import type { CommandResult } from "./domain/result.ts";
import type { LsEntry, WorktreeKind } from "./domain/schema.ts";
import { worktreeState } from "./domain/worktree-state.ts";
import { colorEnabled } from "./infra/term.ts";
import { reportResult } from "./render.ts";

/**
 * `hop ls`'s human-readable table (the plain, non-`--json` output). Built by
 * a pure function so the layout is unit-testable without a terminal; only
 * `reportLs` touches stdout. `--json` and failures still go through
 * render.ts's reportResult unchanged, so the JSON contract is untouched.
 */

type Tone = "plain" | "bold" | "dim" | "green" | "yellow" | "red" | "magenta" | "cyan";

interface Cell {
  readonly text: string;
  readonly tone: Tone;
}

const cell = (text: string, tone: Tone = "plain"): Cell => ({ text, tone });

const paint = (value: Cell, color: boolean): string =>
  !color || value.tone === "plain" ? value.text : `${SGR[value.tone]}${value.text}${SGR_RESET}`;

const SHORT_SHA_LENGTH = 7;
const MIN_PATH_WIDTH = 12;
const MAX_BRANCH_WIDTH = 32;
const COLUMN_GAP = "  ";
/** The "@ " current-worktree marker column. */
const MARKER_WIDTH = 2;

const KIND_ORDER: Record<WorktreeKind, number> = {
  root: 0,
  managed: 1,
  external: 2,
};

const KIND_CELLS: Record<WorktreeKind, Cell> = {
  root: cell("root", "magenta"),
  managed: cell("managed", "cyan"),
  external: cell("external", "yellow"),
};

/** Root first, then managed, then external; branch name ascending within a kind, detached last. */
const compareEntries = (a: LsEntry, b: LsEntry): number => {
  const kindDiff = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  if (kindDiff !== 0) {
    return kindDiff;
  }
  if (a.branch === null || b.branch === null) {
    return (a.branch === null ? 1 : 0) - (b.branch === null ? 1 : 0);
  }
  return a.branch.localeCompare(b.branch);
};

const branchCell = (entry: LsEntry): Cell => {
  if (entry.branch !== null) {
    return cell(truncateToWidth(entry.branch, MAX_BRANCH_WIDTH), "bold");
  }
  const sha = entry.head?.slice(0, SHORT_SHA_LENGTH) ?? "";
  return cell(entry.bare ? "(bare)" : `(detached ${sha})`, "dim");
};

/** One state per row, most important first: a row that can't be acted on says why before "dirty" does. */
const stateCell = (entry: LsEntry): Cell => {
  const state = worktreeState(entry, entry.dirty);
  return cell(state.text, state.tone);
};

/** Commits ahead/behind the upstream: "↑2 ↓1", "=" when in sync, "-" without an upstream. */
const syncCells = (entry: LsEntry): Cell[] => {
  if (entry.ahead === null || entry.behind === null) {
    return [cell("-", "dim")];
  }
  if (entry.ahead === 0 && entry.behind === 0) {
    return [cell("=", "dim")];
  }
  const cells: Cell[] = [];
  if (entry.ahead > 0) {
    cells.push(cell(`↑${entry.ahead}`, "green"));
  }
  if (entry.behind > 0) {
    cells.push(cell(`↓${entry.behind}`, "red"));
  }
  return cells;
};

/** The worktree `cwd` is in: the deepest path containing it (an external worktree can live inside root). */
const currentPath = (entries: readonly LsEntry[], cwd: string): string | null =>
  entries
    .filter((entry) => isWithinOrSelf(entry.path, cwd))
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

interface Row {
  readonly marker: Cell;
  readonly columns: readonly (readonly Cell[])[];
  readonly path: string;
}

const HEADERS = ["BRANCH", "STATE", "REMOTE", "KIND"];

const buildRow = (entry: LsEntry, current: string | null, home: string): Row => ({
  marker: entry.path === current ? cell("@", "green") : cell(" "),
  columns: [[branchCell(entry)], [stateCell(entry)], syncCells(entry), [KIND_CELLS[entry.kind]]],
  path: shortenHome(entry.path, home),
});

const cellsWidth = (cells: readonly Cell[]): number =>
  displayWidth(cells.map((part) => part.text).join(" "));

const renderCells = (cells: readonly Cell[], width: number, color: boolean): string => {
  const text = cells.map((part) => paint(part, color)).join(" ");
  return text + " ".repeat(Math.max(0, width - cellsWidth(cells)));
};

/** Pure: the full table (header, one line per worktree, summary), newline-terminated. */
export const formatLsTable = (entries: readonly LsEntry[], options: LsTableOptions): string => {
  const sorted = entries.toSorted(compareEntries);
  const current = currentPath(sorted, options.cwd);
  const rows = sorted.map((entry) => buildRow(entry, current, options.home));
  const widths = HEADERS.map((header, index) =>
    Math.max(displayWidth(header), ...rows.map((row) => cellsWidth(row.columns[index] ?? []))),
  );
  // "@ " + every column + its gap, then the path takes what is left.
  const fixedWidth =
    MARKER_WIDTH + widths.reduce((total, width) => total + width + COLUMN_GAP.length, 0);
  const pathWidth =
    options.width === null ? null : Math.max(MIN_PATH_WIDTH, options.width - fixedWidth);
  const fitPath = (path: string): string =>
    pathWidth === null ? path : truncateToWidthKeepingTail(path, pathWidth);

  const header = `  ${HEADERS.map((title, index) => padToWidth(title, widths[index] ?? 0)).join(COLUMN_GAP)}${COLUMN_GAP}PATH`;
  const lines = [paint(cell(header, "dim"), options.color)];
  for (const row of rows) {
    const columns = row.columns.map((cells, index) =>
      renderCells(cells, widths[index] ?? 0, options.color),
    );
    const path = paint(cell(fitPath(row.path), "dim"), options.color);
    lines.push(
      `${paint(row.marker, options.color)} ${columns.join(COLUMN_GAP)}${COLUMN_GAP}${path}`,
    );
  }
  const summary = cell(summaryLine(sorted), "dim");
  lines.push("", paint(summary, options.color));
  return `${lines.join("\n")}\n`;
};

/** `hop ls` output: the table for plain success, render.ts's usual path for `--json` and errors. */
export const reportLs = (result: CommandResult<LsEntry[]>, json: boolean): void => {
  if (json || !result.ok || result.data === undefined) {
    reportResult("ls", result, json);
    return;
  }
  const color = colorEnabled(process.stdout);
  process.stdout.write(
    formatLsTable(result.data, {
      color,
      width: process.stdout.isTTY === true ? (process.stdout.columns ?? null) : null,
      home: process.env["HOME"] ?? "",
      cwd: process.cwd(),
    }),
  );
  for (const warning of result.warnings ?? []) {
    process.stderr.write(`warning: ${warning}\n`);
  }
  process.exitCode = result.exitCode;
};

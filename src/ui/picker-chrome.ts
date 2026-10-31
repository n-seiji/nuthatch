import { displayWidth } from "../domain/display-width.ts";
import { baseName } from "../domain/posix-path.ts";
import type { PickCandidate } from "../domain/schema.ts";
import type { StyledLine, StyledSpan } from "./picker-frame.ts";

/**
 * The picker's chrome around the rows: the header (repo name and what is in
 * it), section rules, and the key-hint footer. Pure, like the rest of the
 * picker's line builders.
 */

const RULE = "─";
const HINT_SEPARATOR = " · ";

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

const rootName = (candidates: readonly PickCandidate[]): string | null => {
  for (const candidate of candidates) {
    if (candidate.kind === "worktree" && candidate.worktree.kind === "root") {
      return baseName(candidate.worktree.path);
    }
  }
  return null;
};

/**
 * "◆ app  5 worktrees · 1 with changes · 3 branches", counted over every
 * candidate (not just the filtered ones), plus "· N matches" while a query
 * narrows the list (`matchCount` null = no query).
 */
export const headerLine = (
  candidates: readonly PickCandidate[],
  matchCount: number | null,
): StyledLine => {
  const worktrees = candidates.filter((candidate) => candidate.kind === "worktree");
  const changed = worktrees.filter(
    (candidate) => candidate.kind === "worktree" && candidate.dirty === true,
  ).length;
  const branches = candidates.length - worktrees.length;
  const spans: StyledSpan[] = [{ text: "◆ ", style: "cyan" }];
  const name = rootName(candidates);
  if (name !== null) {
    spans.push({ text: name, style: "bold" }, { text: "  " });
  }
  spans.push({ text: plural(worktrees.length, "worktree", "worktrees") });
  if (changed > 0) {
    spans.push(
      { text: HINT_SEPARATOR, style: "dim" },
      { text: `${changed} with changes`, style: "yellow" },
    );
  }
  if (branches > 0) {
    spans.push({
      text: `${HINT_SEPARATOR}${plural(branches, "branch", "branches")}`,
      style: "dim",
    });
  }
  if (matchCount !== null) {
    spans.push(
      { text: HINT_SEPARATOR, style: "dim" },
      { text: plural(matchCount, "match", "matches"), style: "cyan" },
    );
  }
  return spans;
};

/** A section header drawn as a rule: "WORKTREES ──────────", filling `width`. */
export const ruleLine = (label: string, width: number): StyledLine => {
  const ruleWidth = Math.max(0, width - displayWidth(label) - 1);
  return [
    { text: label, style: "bold-dim" },
    { text: ` ${RULE.repeat(ruleWidth)}`, style: "dim" },
  ];
};

/**
 * Key hints with the key itself in bold: "Enter cd · Esc cancel" becomes
 * "Enter" + " cd" (dim), joined by the same dim " · ", so the line is never
 * wider than the hint it was built from. Every key in the hints is a single
 * space-free token ("Tab/→/Ctrl+L", "↑↓/Ctrl+P,N,K"), so the first space
 * separates key from action.
 */
export const footerLine = (hint: string): StyledLine => {
  const spans: StyledSpan[] = [];
  for (const part of hint.split(HINT_SEPARATOR)) {
    if (spans.length > 0) {
      spans.push({ text: HINT_SEPARATOR, style: "dim" });
    }
    const space = part.indexOf(" ");
    const key = space === -1 ? part : part.slice(0, space);
    const label = space === -1 ? "" : part.slice(space);
    spans.push({ text: key, style: "bold" }, { text: label, style: "dim" });
  }
  return spans;
};

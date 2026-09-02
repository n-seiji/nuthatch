import type { Worktree } from "./model.ts";

const REFS_HEADS_PREFIX = "refs/heads/";

/** A parsed worktree record, before kind classification is applied. */
export type ParsedWorktree = Omit<Worktree, "kind">;

const branchNameFromRef = (ref: string): string =>
  ref.startsWith(REFS_HEADS_PREFIX) ? ref.slice(REFS_HEADS_PREFIX.length) : ref;

const parseRecord = (lines: readonly string[]): ParsedWorktree | null => {
  let path: string | null = null;
  let head: string | null = null;
  let branch: string | null = null;
  let detached = false;
  let bare = false;
  let locked = false;
  let lockReason: string | null = null;
  let prunable = false;
  let prunableReason: string | null = null;

  for (const line of lines.filter((candidate) => candidate.length > 0)) {
    const spaceIndex = line.indexOf(" ");
    const key = spaceIndex === -1 ? line : line.slice(0, spaceIndex);
    const value = spaceIndex === -1 ? "" : line.slice(spaceIndex + 1);

    switch (key) {
      case "worktree": {
        path = value;
        break;
      }
      case "HEAD": {
        head = value;
        break;
      }
      case "branch": {
        branch = branchNameFromRef(value);
        break;
      }
      case "detached": {
        detached = true;
        break;
      }
      case "bare": {
        bare = true;
        break;
      }
      case "locked": {
        locked = true;
        lockReason = value.length > 0 ? value : null;
        break;
      }
      case "prunable": {
        prunable = true;
        prunableReason = value.length > 0 ? value : null;
        break;
      }
      default: {
        // Unknown field: ignore for forward compatibility.
        break;
      }
    }
  }

  if (path === null) {
    return null;
  }

  return {
    path,
    head,
    branch,
    detached,
    bare,
    locked,
    lockReason,
    prunable,
    prunableReason,
  };
};

/**
 * Parses the output of `git worktree list --porcelain -z`.
 * Records are NUL-terminated lines, with an extra NUL separating records.
 * Malformed records without a `worktree` path are dropped.
 */
export const parsePorcelain = (output: string): ParsedWorktree[] => {
  if (output.length === 0) {
    return [];
  }

  const trimmed = output.endsWith("\0") ? output.slice(0, -1) : output;
  const records = trimmed.split("\0\0");

  const result: ParsedWorktree[] = [];
  for (const record of records.filter((candidate) => candidate.length > 0)) {
    const lines = record.split("\0");
    const parsed = parseRecord(lines);
    if (parsed !== null) {
      result.push(parsed);
    }
  }
  return result;
};

export type { WorktreeKind } from "./model.ts";

import { REFS_HEADS_PREFIX } from "./porcelain.ts";

/**
 * Every local branch's relation to its upstream, read from one
 * `git for-each-ref` instead of one `git rev-list` per branch: `hop ls` and
 * `hop clean` look at every worktree's branch, and a spawn per branch
 * would dominate their git time on a repo with many worktrees.
 */

export type UpstreamState =
  /** No upstream configured (or it can't be resolved to a ref). */
  | { readonly kind: "none" }
  /** An upstream is configured but its ref no longer exists. */
  | { readonly kind: "gone" }
  | { readonly kind: "tracking"; readonly ahead: number; readonly behind: number };

const NONE: UpstreamState = { kind: "none" };
const FIELD_SEPARATOR = "\0";

/**
 * `--format` for `git for-each-ref refs/heads/`: refname, upstream refname,
 * and the upstream's ahead/behind summary without brackets ("", "gone",
 * "ahead 1", "behind 2", or "ahead 1, behind 2"), NUL-separated. A refname
 * can't contain a newline or NUL, so each line is one branch.
 */
export const UPSTREAM_FORMAT = "%(refname)%00%(upstream)%00%(upstream:track,nobracket)";

const countOf = (track: string, word: "ahead" | "behind"): number => {
  const match = new RegExp(`${word} (?<count>\\d+)`, "u").exec(track);
  return match?.groups?.count === undefined ? 0 : Number(match.groups.count);
};

const parseTrack = (upstream: string, track: string): UpstreamState => {
  if (upstream.length === 0) {
    return NONE;
  }
  if (track === "gone") {
    return { kind: "gone" };
  }
  return { kind: "tracking", ahead: countOf(track, "ahead"), behind: countOf(track, "behind") };
};

/** Parses `UPSTREAM_FORMAT` output into a map keyed by short branch name. */
export const parseUpstreamStates = (output: string): Map<string, UpstreamState> => {
  const states = new Map<string, UpstreamState>();
  for (const line of output.split("\n")) {
    const [refname = "", upstream = "", track = ""] = line.split(FIELD_SEPARATOR);
    if (refname.startsWith(REFS_HEADS_PREFIX)) {
      states.set(refname.slice(REFS_HEADS_PREFIX.length), parseTrack(upstream, track.trim()));
    }
  }
  return states;
};

/** A branch the map doesn't know (e.g. created after it was read) has no upstream. */
export const upstreamStateOf = (
  states: ReadonlyMap<string, UpstreamState>,
  branch: string,
): UpstreamState => states.get(branch) ?? NONE;

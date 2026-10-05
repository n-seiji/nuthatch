/**
 * What a branch that has no local copy should track (docs/design.md,
 * "creating from a remote branch"). `ambiguous` means several remotes have
 * it and none of them is origin, so the caller must ask for an explicit
 * `--track` instead of guessing.
 */
export type TrackingResolution =
  | { readonly kind: "track"; readonly ref: string }
  | { readonly kind: "none" }
  | { readonly kind: "ambiguous" };

/**
 * `remotes` are the remotes that have a branch named `branch`. origin always
 * wins, even when other remotes have the branch too.
 */
export const resolveTrackingRef = (
  branch: string,
  remotes: readonly string[],
): TrackingResolution => {
  if (remotes.includes("origin")) {
    return { kind: "track", ref: `origin/${branch}` };
  }
  const [first, second] = remotes;
  if (first === undefined) {
    return { kind: "none" };
  }
  if (second !== undefined) {
    return { kind: "ambiguous" };
  }
  return { kind: "track", ref: `${first}/${branch}` };
};

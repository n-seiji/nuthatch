import type { StatusCommit } from "./schema.ts";

/** The `git log` format `parseLastCommit` reads: sha, committer date (ISO 8601), subject — NUL-separated. */
export const LAST_COMMIT_FORMAT = "%H%x00%cI%x00%s";

/** Parses `git log -1 --format=<LAST_COMMIT_FORMAT>` output; null when there is no commit to read. */
export const parseLastCommit = (output: string): StatusCommit | null => {
  const [sha, date, ...subjectParts] = output.replace(/\n$/u, "").split("\0");
  if (sha === undefined || sha.length === 0 || date === undefined) {
    return null;
  }
  // A subject never contains NUL, but joining keeps the parse total.
  return { sha, date, subject: subjectParts.join("\0") };
};

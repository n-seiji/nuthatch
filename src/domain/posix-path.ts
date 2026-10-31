/**
 * Just enough POSIX path handling for the domain layer, which cannot import
 * `node:path`. hop only ships for darwin/linux.
 */

const withoutTrailingSlash = (path: string): string =>
  path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;

/** Replaces a leading `home` directory with `~`; paths outside it (and an empty or `/` home) pass through. */
export const shortenHome = (path: string, home: string): string => {
  if (home === "" || home === "/") {
    return path;
  }
  if (path === home) {
    return "~";
  }
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
};

/** The directory holding `path`: `/` for a top-level entry, `.` for a bare name. */
export const parentDir = (path: string): string => {
  const trimmed = withoutTrailingSlash(path);
  const index = trimmed.lastIndexOf("/");
  if (index === -1) {
    return ".";
  }
  return index === 0 ? "/" : trimmed.slice(0, index);
};

/** The last path segment: `app` for `/a/b/app/`; `/` stays `/`. */
export const baseName = (path: string): string => {
  const trimmed = withoutTrailingSlash(path);
  return trimmed === "/" ? trimmed : trimmed.slice(trimmed.lastIndexOf("/") + 1);
};

/**
 * Absolute `dir/name` candidates in `dirs`' order, each entry trimmed and
 * deduplicated. A relative entry (`.`, `node_modules/.bin`) is dropped rather
 * than resolved against the cwd: hop runs inside whatever repository it was
 * started in, and a program found relative to it would be someone else's code.
 */
export const absoluteCandidates = (dirs: readonly string[], name: string): readonly string[] => [
  ...new Set(
    dirs
      .map((entry) => entry.trim())
      .filter((entry) => entry.startsWith("/"))
      .map((dir) => `${dir.endsWith("/") ? dir.slice(0, -1) : dir}/${name}`),
  ),
];

/** The entries of a `PATH`-style value (empty when unset). */
export const splitPathEnv = (pathEnv?: string): readonly string[] => (pathEnv ?? "").split(":");

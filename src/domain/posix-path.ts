/**
 * Just enough POSIX path handling for the domain layer, which cannot import
 * `node:path`. hop only ships for darwin/linux.
 */

const withoutTrailingSlash = (path: string): string =>
  path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;

/** The directory holding `path`: `/` for a top-level entry, `.` for a bare name. */
export const parentDir = (path: string): string => {
  const trimmed = withoutTrailingSlash(path);
  const index = trimmed.lastIndexOf("/");
  if (index === -1) {
    return ".";
  }
  return index === 0 ? "/" : trimmed.slice(0, index);
};

/** The last segment of `path`. */
export const baseName = (path: string): string => {
  const trimmed = withoutTrailingSlash(path);
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
};

const MAX_DIR_NAME_LENGTH = 200;
const HASH_LENGTH = 8;

/** FNV-1a 32-bit hash, hex-encoded. Pure and deterministic — no crypto import needed. */
const shortHash = (input: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").slice(0, HASH_LENGTH);
};

const baseName = (branch: string): string => branch.replaceAll("/", "__");

const truncate = (name: string, maxLength: number): string =>
  name.length > maxLength ? name.slice(0, maxLength) : name;

/**
 * Converts a branch name into a filesystem-safe directory name.
 *
 * `isTaken` is called with candidate directory names and should return true if
 * that name is already in use (e.g. an existing directory, or case-insensitively
 * colliding with one). It is injected so this function stays a pure predicate
 * consumer with no filesystem access.
 */
export const sanitizeBranchName = (
  branch: string,
  isTaken: (candidate: string) => boolean,
): string => {
  const base = truncate(baseName(branch), MAX_DIR_NAME_LENGTH);

  if (!isTaken(base)) return base;

  const hash = shortHash(branch);
  let candidate = `${truncate(base, MAX_DIR_NAME_LENGTH - hash.length - 1)}-${hash}`;
  let suffix = 1;
  while (isTaken(candidate)) {
    const withSuffix = `${hash}-${suffix}`;
    candidate = `${truncate(base, MAX_DIR_NAME_LENGTH - withSuffix.length - 1)}-${withSuffix}`;
    suffix++;
  }
  return candidate;
};

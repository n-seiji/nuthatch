const MAX_DIR_NAME_LENGTH = 200;
const HASH_LENGTH = 8;
const HEX_RADIX = 16;
const FULL_HASH_HEX_LENGTH = 8;
const FNV_OFFSET_BASIS = 0x81_1c_9d_c5;
const FNV_PRIME = 0x01_00_01_93;

/** FNV-1a 32-bit hash, hex-encoded. Pure and deterministic — no crypto import needed. */
const shortHash = (input: string): string => {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < input.length; i++) {
    // Using charCodeAt (not codePointAt) is intentional: this loop advances one
    // UTF-16 code unit at a time, which is what a byte/unit-level hash needs.
    // CodePointAt would return `undefined` when `i` lands on the low half of
    // A surrogate pair, corrupting the hash — it's not a drop-in replacement here.
    // oxlint-disable-next-line unicorn/prefer-code-point
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return (hash >>> 0).toString(HEX_RADIX).padStart(FULL_HASH_HEX_LENGTH, "0").slice(0, HASH_LENGTH);
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

  if (!isTaken(base)) {
    return base;
  }

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

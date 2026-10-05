/**
 * The pure pieces of `hop --update`: where releases are published, how a
 * version or a checksum file is read, and which PATH entries may hold a
 * package manager. Every network address here is fixed — hop never fetches a
 * URL it was handed. How the install method is decided lives in
 * install-method.ts.
 */
import { NPM_PACKAGE } from "./install-method.ts";

const GITHUB_REPO = "n-seiji/nuthatch";

export const GITHUB_LATEST_RELEASE_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

/** The registry wants the scope's slash percent-encoded: `@scope%2Fname`. */
export const NPM_LATEST_URL = `https://registry.npmjs.org/${NPM_PACKAGE.replace("/", "%2F")}/latest`;

/**
 * An asset of one specific release. The URL names the tag that was resolved
 * (and compared) earlier, never `latest/download`, so a release published
 * between the check and the download cannot swap the binary underneath it.
 */
export const releaseAssetUrl = (version: string, assetName: string): string =>
  `https://github.com/${GITHUB_REPO}/releases/download/v${version}/${assetName}`;

const VERSION_PATTERN = /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$/u;
const TAG_PATTERN = /^v(?<version>\d+\.\d+\.\d+)$/u;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/iu;
const PATH_SEPARATOR = ":";

const parseVersion = (text: string): readonly [number, number, number] => {
  const groups = VERSION_PATTERN.exec(text)?.groups;
  if (groups?.major === undefined || groups.minor === undefined || groups.patch === undefined) {
    throw new Error(`unrecognized version "${text}" (expected x.y.z)`);
  }
  return [Number(groups.major), Number(groups.minor), Number(groups.patch)];
};

/**
 * Orders two `x.y.z` versions numerically per part (positive when `a` is the
 * newer one). Anything else — a prerelease, a missing part — throws instead
 * of being guessed at: a wrong guess here would downgrade or skip an update.
 */
export const compareVersions = (a: string, b: string): number => {
  const [aMajor, aMinor, aPatch] = parseVersion(a);
  const [bMajor, bMinor, bPatch] = parseVersion(b);
  return aMajor - bMajor || aMinor - bMinor || aPatch - bPatch;
};

/** Returns `text` unchanged when it is a plain `x.y.z` version, throws otherwise. */
export const requireVersion = (text: string): string => {
  parseVersion(text);
  return text;
};

/** `v0.1.4` -> `0.1.4`. The release workflow only ever publishes `vX.Y.Z` tags. */
export const versionFromTag = (tag: string): string => {
  const version = TAG_PATTERN.exec(tag)?.groups?.version;
  if (version === undefined) {
    throw new Error(`unrecognized release tag "${tag}" (expected vX.Y.Z)`);
  }
  return version;
};

/**
 * The expected digest out of a release's `.sha256` file. The workflow writes
 * `sha256sum` output (`<hex>  out/hop-linux-x64\n`), so only the first
 * whitespace-separated token counts. Null when it is not a 64-digit hex
 * string, which callers treat as "cannot verify" rather than "no checksum".
 */
export const parseChecksumFile = (text: string): string | null => {
  const [first] = text.trim().split(/\s+/u);
  return first !== undefined && SHA256_HEX_PATTERN.test(first) ? first.toLowerCase() : null;
};

/**
 * Absolute candidate paths for `name`, in PATH order. A relative PATH entry
 * is dropped rather than resolved against the cwd, for the same reason as
 * git's (git-executable.ts): hop must never run a program out of whatever
 * directory it happens to be started in. No fallback directories here — an
 * upgrade command that is not on PATH is reported, not guessed.
 */
export const pathExecutableCandidates = (name: string, pathEnv?: string): readonly string[] => {
  const dirs = (pathEnv ?? "")
    .split(PATH_SEPARATOR)
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith("/"));
  return [...new Set(dirs.map((dir) => `${dir.endsWith("/") ? dir.slice(0, -1) : dir}/${name}`))];
};

/** An fs error saying hop may not write where it needs to (EACCES / EPERM). */
export const isPermissionDenied = (error: unknown): boolean =>
  error instanceof Error && "code" in error && (error.code === "EACCES" || error.code === "EPERM");

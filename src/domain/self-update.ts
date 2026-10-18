/**
 * The pure pieces of `hop --update`: where releases are published and how a
 * version or a checksum file is read. Every network address here is fixed — hop never fetches a
 * URL it was handed. How the install method is decided lives in
 * install-method.ts.
 */

const GITHUB_REPO = "n-seiji/nuthatch";

export const GITHUB_LATEST_RELEASE_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

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

/** `v0.1.4` -> `0.1.4`. The release workflow only ever publishes `vX.Y.Z` tags. */
export const versionFromTag = (tag: string): string => {
  const version = TAG_PATTERN.exec(tag)?.groups?.version;
  if (version === undefined) {
    throw new Error(`unrecognized release tag "${tag}" (expected vX.Y.Z)`);
  }
  return version;
};

/** What a release's `.sha256` file says: the digest to expect, or why it cannot be trusted. */
export type ChecksumFile =
  | { readonly ok: true; readonly digest: string }
  | { readonly ok: false; readonly reason: string };

/**
 * The expected digest out of the `.sha256` file for `assetName`. The workflow
 * writes `sha256sum` output (`<hex>  out/hop-linux-x64\n`), so only the first
 * two whitespace-separated tokens count: the digest, then the file it is for
 * (a leading `*` is sha256sum's binary-mode marker). When a file is named it
 * must be this asset, since a digest of some other file proves nothing about
 * this one; a bare digest is accepted. Anything else is "cannot verify", not
 * "no checksum".
 */
export const parseChecksumFile = (text: string, assetName: string): ChecksumFile => {
  const [digest, file] = text.trim().split(/\s+/u);
  if (digest === undefined || !SHA256_HEX_PATTERN.test(digest)) {
    return { ok: false, reason: "is malformed" };
  }
  const named = file?.replace(/^\*/u, "");
  if (named !== undefined && named !== assetName && !named.endsWith(`/${assetName}`)) {
    return { ok: false, reason: `is for "${named}", not ${assetName}` };
  }
  return { ok: true, digest: digest.toLowerCase() };
};

/**
 * An fs error saying hop may not write where it needs to: no permission
 * (EACCES / EPERM) or a read-only filesystem (EROFS).
 */
export const isWriteDenied = (error: unknown): boolean =>
  error instanceof Error &&
  "code" in error &&
  (error.code === "EACCES" || error.code === "EPERM" || error.code === "EROFS");

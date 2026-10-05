import { messageOf } from "../domain/fatal-error.ts";
import type { StandaloneMethod } from "../domain/install-method.ts";
import type { SelfUpdatePort, TermPort } from "../domain/ports.ts";
import {
  type CommandResult,
  EXIT_GENERAL_ERROR,
  EXIT_SAFE_REJECTION,
  fail,
  ok,
} from "../domain/result.ts";
import type { UpdateData } from "../domain/schema.ts";
import { isPermissionDenied, parseChecksumFile } from "../domain/self-update.ts";
import { attempt } from "./self-update-attempt.ts";

/**
 * Compares the downloaded bytes with the release's published SHA-256. Both a
 * mismatch and an unreadable checksum file refuse the install (exit 3, a
 * safety rejection): without a verified digest the binary is untrusted, and
 * nothing has been written yet.
 */
const checksumRejection = (
  port: SelfUpdatePort,
  assetName: string,
  checksumText: string,
  bytes: Uint8Array,
): CommandResult<UpdateData> | null => {
  const expected = parseChecksumFile(checksumText);
  if (expected === null) {
    return fail(
      EXIT_SAFE_REJECTION,
      `The checksum file ${assetName}.sha256 is malformed; refusing to install an unverified binary.`,
    );
  }
  const actual = port.sha256Hex(bytes);
  if (actual !== expected) {
    return fail(
      EXIT_SAFE_REJECTION,
      `Checksum mismatch for ${assetName} (expected ${expected}, got ${actual}); refusing to install it. Nothing was changed.`,
    );
  }
  return null;
};

const replaceFailureMessage = (method: StandaloneMethod, error: unknown): string =>
  isPermissionDenied(error)
    ? `Cannot write ${method.installDir}; reinstall hop somewhere writable (install.sh uses ~/.local/bin).`
    : `Failed to replace ${method.binaryPath}: ${messageOf(error)}`;

/**
 * Standalone install: download the release asset of the version that was just
 * resolved, verify it against its `.sha256` the way install.sh does, and only
 * then swap it in over the running binary. Every step before the swap leaves
 * the filesystem untouched. `base.latest` is the version to fetch.
 */
export const replaceStandalone = async (
  port: SelfUpdatePort,
  term: TermPort,
  method: StandaloneMethod,
  base: UpdateData,
): Promise<CommandResult<UpdateData>> => {
  const { assetName, binaryPath } = method;
  const checksumAsset = `${assetName}.sha256`;
  term.logStderr(`Downloading ${assetName} v${base.latest}...`);

  const checksum = await attempt(() => port.downloadReleaseText(base.latest, checksumAsset));
  if (!checksum.ok) {
    return fail(
      EXIT_GENERAL_ERROR,
      `Failed to download ${checksumAsset}: ${messageOf(checksum.error)}`,
    );
  }
  const binary = await attempt(() => port.downloadReleaseAsset(base.latest, assetName));
  if (!binary.ok) {
    return fail(EXIT_GENERAL_ERROR, `Failed to download ${assetName}: ${messageOf(binary.error)}`);
  }

  const rejection = checksumRejection(port, assetName, checksum.value, binary.value);
  if (rejection !== null) {
    return rejection;
  }

  term.logStderr(`Checksum verified. Replacing ${binaryPath}...`);
  const replaced = await attempt(() => port.replaceExecutable(binaryPath, binary.value));
  if (!replaced.ok) {
    return fail(EXIT_GENERAL_ERROR, replaceFailureMessage(method, replaced.error));
  }

  term.logStderr(`Updated hop ${base.current} -> ${base.latest}.`);
  return ok({ data: { ...base, action: "replaced" } });
};

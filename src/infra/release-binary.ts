import { createHash, randomBytes } from "node:crypto";
import { chmod, realpath, rename, rm, writeFile } from "node:fs/promises";

/**
 * Verifying and installing a downloaded release binary. `sha256Hex` is what
 * the checksum comparison runs on; `replaceExecutable` is the only place hop
 * writes outside its own lock/tmp files.
 */

const EXECUTABLE_MODE = 0o755;
const TEMP_SUFFIX_BYTES = 6;

export const sha256Hex = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const removeQuietly = async (path: string): Promise<void> => {
  try {
    await rm(path, { force: true });
  } catch {
    // Best effort: the error that made the write fail is the one worth reporting.
  }
};

/**
 * Swaps the executable at `path` for `bytes` without ever leaving a
 * half-written binary: the new content goes to a temp file in the *same*
 * directory (so the final `rename` stays on one filesystem and is atomic),
 * then renames over the real file. A symlink is followed first, so a
 * `~/.local/bin/hop -> …` link keeps pointing at the updated target.
 * Whatever fails, the temp file is removed and the original is left alone.
 *
 * The explicit chmod matters: `writeFile`'s `mode` only applies on creation
 * and is masked by the umask, which would otherwise leave a 0700 binary.
 * The running process keeps its old inode, so replacing the binary hop is
 * currently executing is safe.
 */
export const replaceExecutable = async (path: string, bytes: Uint8Array): Promise<void> => {
  const target = await realpath(path);
  const temp = `${target}.tmp.${randomBytes(TEMP_SUFFIX_BYTES).toString("hex")}`;
  try {
    await writeFile(temp, bytes, { mode: EXECUTABLE_MODE, flag: "wx" });
    await chmod(temp, EXECUTABLE_MODE);
    await rename(temp, target);
  } catch (error) {
    await removeQuietly(temp);
    throw error;
  }
};

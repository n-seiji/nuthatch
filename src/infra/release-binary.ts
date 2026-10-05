import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access, open, realpath, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

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
 * Writes `bytes` to a new file at `path` (it must not exist) and fsyncs it,
 * so that the rename that follows can never publish content that is still
 * only in the page cache. The chmod is on the open handle because `open`'s
 * mode only applies on creation and is masked by the umask, which would
 * otherwise leave a 0700 binary.
 */
const writeDurably = async (path: string, bytes: Uint8Array): Promise<void> => {
  const handle = await open(path, "wx", EXECUTABLE_MODE);
  try {
    await handle.writeFile(bytes);
    await handle.chmod(EXECUTABLE_MODE);
    await handle.sync();
  } finally {
    await handle.close();
  }
};

/**
 * Swaps the executable at `path` for `bytes` without ever leaving a
 * half-written binary: the new content goes to a temp file in the *same*
 * directory (so the final `rename` stays on one filesystem and is atomic),
 * is fsynced, then renamed over the real file. A symlink is followed first,
 * so a `~/.local/bin/hop` link keeps pointing at the updated target. The temp
 * file is hidden (`.hop.update-<hex>`): if the process is killed mid-write,
 * what stays behind is not an executable that looks like a second hop.
 * Whatever fails otherwise, the temp file is removed and the original is left
 * alone. The running process keeps its old inode, so replacing the binary hop
 * is currently executing is safe.
 */
export const replaceExecutable = async (path: string, bytes: Uint8Array): Promise<void> => {
  const target = await realpath(path);
  const suffix = randomBytes(TEMP_SUFFIX_BYTES).toString("hex");
  const temp = join(dirname(target), `.${basename(target)}.update-${suffix}`);
  try {
    await writeDurably(temp, bytes);
    await rename(temp, target);
  } catch (error) {
    await removeQuietly(temp);
    throw error;
  }
};

/**
 * Whether files can be created in `dir` (write and search permission, and not
 * a read-only filesystem), asked before anything is downloaded so that an
 * unwritable install dir is learned in milliseconds instead of after tens of
 * MB.
 */
export const assertWritableDir = (dir: string): Promise<void> =>
  access(dir, constants.W_OK | constants.X_OK);

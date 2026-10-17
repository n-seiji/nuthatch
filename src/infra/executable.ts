import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";

const isExecutableFile = async (path: string): Promise<boolean> => {
  try {
    const stats = await stat(path);
    if (!stats.isFile()) {
      return false;
    }
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * The first of `candidates` that is an executable file, or null. Every probe
 * is launched at once (a handful of stat calls, and awaiting them one by one
 * serialises the fs threadpool), then awaited in candidate order so the first
 * entry wins and nothing waits past it.
 */
export const firstExecutable = async (candidates: readonly string[]): Promise<string | null> => {
  const probes = candidates.map(async (candidate) =>
    (await isExecutableFile(candidate)) ? candidate : null,
  );
  for (const probe of probes) {
    // oxlint-disable-next-line no-await-in-loop
    const found = await probe;
    if (found !== null) {
      return found;
    }
  }
  return null;
};

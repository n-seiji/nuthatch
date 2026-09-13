import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canReclaimLock } from "../domain/lock-policy.ts";
import { type CommandResult, EXIT_SAFE_REJECTION, fail } from "../domain/result.ts";

const LOCK_DIR_NAME = "nuthatch-lock";
const LOCK_INFO_FILE = "info.json";
const DEFAULT_TTL_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 5000;

interface LockInfo {
  pid: number;
  startedAtMs: number;
  token: string;
}

export class LockHeldError extends Error {
  readonly info: LockInfo;

  constructor(info: LockInfo) {
    super(`Repository is locked by another nuthatch process (pid ${info.pid})`);
    this.name = "LockHeldError";
    this.info = info;
  }
}

const isProcessAlive = (pid: number): boolean | "unknown" => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === "ESRCH") {
      return false;
    }
    if (code === "EPERM") {
      // Exists, just not signalable by us.
      return true;
    }
    return "unknown";
  }
};

const readLockInfo = async (lockDir: string): Promise<LockInfo | null> => {
  try {
    const raw = await readFile(join(lockDir, LOCK_INFO_FILE), "utf8");
    return JSON.parse(raw) as LockInfo;
  } catch {
    return null;
  }
};

const writeLockInfo = async (lockDir: string, info: LockInfo): Promise<void> => {
  await writeFile(join(lockDir, LOCK_INFO_FILE), JSON.stringify(info), "utf8");
};

export interface RepoLock {
  release: () => Promise<void>;
}

/**
 * Acquires an exclusive, repo-wide mutation lock inside the git common dir.
 * Throws LockHeldError if another live process holds it. A stale lock (owner
 * confirmed dead AND past TTL) is reclaimed automatically; anything else is a
 * safe refusal, per docs/design.md.
 */
export const acquireRepoLock = async (
  commonDir: string,
  ttlMs = DEFAULT_TTL_MS,
): Promise<RepoLock> => {
  const lockDir = join(commonDir, LOCK_DIR_NAME);

  // Each retry below depends on the previous attempt's outcome (mkdir fails ->
  // Inspect -> maybe reclaim -> retry mkdir); there is nothing to parallelize,
  // So the no-await-in-loop warnings on this loop's awaits are not applicable.
  for (;;) {
    try {
      // oxlint-disable-next-line no-await-in-loop
      await mkdir(lockDir);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }

      // oxlint-disable-next-line no-await-in-loop
      const existing = await readLockInfo(lockDir);
      if (existing === null) {
        // Lock dir exists but info is unreadable/missing: cannot verify safely.
        throw new LockHeldError({ pid: -1, startedAtMs: 0, token: "unknown" });
      }

      const reclaimable = canReclaimLock({
        processAlive: isProcessAlive(existing.pid),
        startedAtMs: existing.startedAtMs,
        nowMs: Date.now(),
        ttlMs,
      });

      if (!reclaimable) {
        throw new LockHeldError(existing);
      }

      // oxlint-disable-next-line no-await-in-loop
      await rm(lockDir, { recursive: true, force: true });
      // Loop back and retry the mkdir.
    }
  }

  const info: LockInfo = {
    pid: process.pid,
    startedAtMs: Date.now(),
    token: randomUUID(),
  };
  await writeLockInfo(lockDir, info);

  const heartbeat = setInterval(() => {
    void writeLockInfo(lockDir, { ...info, startedAtMs: Date.now() });
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  return {
    async release() {
      clearInterval(heartbeat);
      await rm(lockDir, { recursive: true, force: true });
    },
  };
};

export type RepoLockAcquisition<T> =
  | { readonly ok: true; readonly lock: RepoLock }
  | { readonly ok: false; readonly rejection: CommandResult<T> };

/**
 * Same as acquireRepoLock, but turns a LockHeldError into a normal
 * CommandResult rejection (exit 3, safe rejection) instead of a thrown
 * exception. Another process holding the repo lock is a safe, expected
 * outcome — not an internal error — so it must surface through the
 * command's usual structured-error path (intact `--json` envelope) rather
 * than as an uncaught exception with a bare stack trace. Any other error
 * (e.g. an unreadable lock dir permission failure) still throws, since
 * that's a genuine unexpected failure.
 */
export const acquireRepoLockOrRejection = async <T>(
  commonDir: string,
  ttlMs?: number,
): Promise<RepoLockAcquisition<T>> => {
  try {
    const lock = await acquireRepoLock(commonDir, ttlMs);
    return { ok: true, lock };
  } catch (error) {
    if (error instanceof LockHeldError) {
      return { ok: false, rejection: fail(EXIT_SAFE_REJECTION, error.message) };
    }
    throw error;
  }
};

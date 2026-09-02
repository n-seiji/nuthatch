import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canReclaimLock } from "../domain/lock-policy.ts";

const LOCK_DIR_NAME = "nuthatch-lock";
const LOCK_INFO_FILE = "info.json";
const DEFAULT_TTL_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 5_000;

interface LockInfo {
  pid: number;
  startedAtMs: number;
  token: string;
}

export class LockHeldError extends Error {
  constructor(readonly info: LockInfo) {
    super(`Repository is locked by another nuthatch process (pid ${info.pid})`);
  }
}

const isProcessAlive = (pid: number): boolean | "unknown" => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true; // exists, just not signalable by us
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
  release(): Promise<void>;
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

  for (;;) {
    try {
      await mkdir(lockDir);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;

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

      if (!reclaimable) throw new LockHeldError(existing);

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

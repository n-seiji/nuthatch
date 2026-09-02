/** Facts about an existing lock, used to decide whether it may be reclaimed. */
export interface LockReclaimInput {
  readonly processAlive: boolean | "unknown";
  readonly startedAtMs: number;
  readonly nowMs: number;
  readonly ttlMs: number;
}

/**
 * A held lock may only be reclaimed if the owning process is confirmed dead
 * AND the lock has exceeded its TTL. If liveness cannot be determined, the
 * safe default is to refuse reclaiming (per docs/design.md: "確認不能なら拒否").
 */
export const canReclaimLock = (input: LockReclaimInput): boolean => {
  if (input.processAlive !== false) {
    return false;
  }
  return input.nowMs - input.startedAtMs > input.ttlMs;
};

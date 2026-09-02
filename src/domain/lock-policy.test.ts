import { describe, expect, it } from "bun:test";
import { canReclaimLock } from "./lock-policy.ts";

describe("canReclaimLock", () => {
  it("プロセスが生存している場合、TTL を超えていても回収しない", () => {
    expect(
      canReclaimLock({
        processAlive: true,
        startedAtMs: 0,
        nowMs: 100_000,
        ttlMs: 1_000,
      }),
    ).toBe(false);
  });

  it("プロセスが死んでいて TTL も超えている場合、回収する", () => {
    expect(
      canReclaimLock({
        processAlive: false,
        startedAtMs: 0,
        nowMs: 100_000,
        ttlMs: 1_000,
      }),
    ).toBe(true);
  });

  it("プロセスが死んでいても TTL 内なら回収しない", () => {
    expect(
      canReclaimLock({
        processAlive: false,
        startedAtMs: 0,
        nowMs: 500,
        ttlMs: 1_000,
      }),
    ).toBe(false);
  });

  it("生存確認が unknown の場合、安全側で回収しない", () => {
    expect(
      canReclaimLock({
        processAlive: "unknown",
        startedAtMs: 0,
        nowMs: 100_000,
        ttlMs: 1_000,
      }),
    ).toBe(false);
  });
});

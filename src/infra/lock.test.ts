import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { type CommandResult, ok } from "../domain/result.ts";
import { acquireRepoLock, withRepoLock } from "./lock.ts";

let commonDir: string;

beforeEach(async () => {
  commonDir = await mkdtemp(join(tmpdir(), "nuthatch-lock-test-"));
});

afterEach(async () => {
  await rm(commonDir, { recursive: true, force: true });
});

const succeedWith = (data: string) => (): Promise<CommandResult<string>> =>
  Promise.resolve(ok({ data }));

const failWith = (message: string) => (): Promise<CommandResult<string>> =>
  Promise.reject(new Error(message));

describe("withRepoLock", () => {
  it("mutate が成功した場合、その結果を返し、lock を解放する", async () => {
    const result = await withRepoLock<string>(commonDir, succeedWith("first"));

    expect(result).toEqual(ok({ data: "first" }));
    // The second call can only acquire the lock if the first one released it.
    const second = await withRepoLock<string>(commonDir, succeedWith("second"));
    expect(second).toEqual(ok({ data: "second" }));
  });

  it("mutate が throw した場合、そのエラーを伝播し、lock は解放される", async () => {
    await expect(withRepoLock<string>(commonDir, failWith("boom"))).rejects.toThrow("boom");

    const after = await withRepoLock<string>(commonDir, succeedWith("after"));
    expect(after).toEqual(ok({ data: "after" }));
  });

  it("lock が既に保持されている場合、mutate を呼ばず exit 3 の拒否を返す", async () => {
    const mutate = mock(succeedWith("unexpected"));
    const heldLock = await acquireRepoLock(commonDir);
    try {
      const result = await withRepoLock<string>(commonDir, mutate);

      expect(result.ok).toBe(false);
      expect(result.exitCode).toBe(3);
      expect(mutate).not.toHaveBeenCalled();
    } finally {
      await heldLock.release();
    }
  });

  it("lock の取得が保持以外の理由で失敗した場合、拒否に変換せず throw する", async () => {
    const missingCommonDir = join(commonDir, "does-not-exist");

    await expect(
      withRepoLock<string>(missingCommonDir, succeedWith("unreachable")),
    ).rejects.toThrow();
  });
});

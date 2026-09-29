import { chmod, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { EXIT_GENERAL_ERROR, EXIT_SAFE_REJECTION } from "./domain/result.ts";
import { runHop } from "./testing/cli.ts";
import { createTestRepo, type TestRepo } from "./testing/repo.ts";

/**
 * Regression coverage for issue #9: `hop` printed a raw JS stack trace
 * (`ENOENT: no such file or directory, posix_spawn 'git'` plus a Bun frame
 * dump) whenever spawning git failed. These tests launch the real
 * entrypoint as a child process and assert the CLI contract instead: one
 * line on stderr, the documented exit code — 1 for a missing git binary,
 * 3 for a git failure — and an intact `--json` envelope when one was asked
 * for.
 *
 * The PATH-less case (hop resolving git from its own candidate list) is
 * pinned on the compiled binary in cli-compiled-binary.contract.test.ts,
 * which is both cheaper and closer to the reported environment.
 */

const EXECUTABLE_MODE = 0o755;

/** A stack trace shows up as a "at <frame>" line or Bun's version footer. */
const looksLikeStackTrace = (output: string): boolean =>
  /^\s+at\s/mu.test(output) || /^Bun v\d/mu.test(output);

let repo: TestRepo;

beforeAll(async () => {
  repo = await createTestRepo();
});

afterAll(async () => {
  await repo.cleanup();
});

describe("git を spawn できないときの CLI 契約", () => {
  it("git が見つからなければ 1 行のエラー + exit 1 (スタックトレースは出さない)", async () => {
    const result = await runHop(["ls"], repo.repoPath, {
      ...repo.env,
      HOP_GIT: join(repo.rootDir, "nowhere", "git"),
    });

    expect(result.exitCode).toBe(EXIT_GENERAL_ERROR);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("hop: git executable not found");
    expect(result.stderr).toContain("HOP_GIT");
    expect(looksLikeStackTrace(result.stderr)).toBe(false);
  });

  it("PATH の相対エントリ配下の git は拾わない (cwd 依存の実行を防ぐ)", async () => {
    // リポジトリ内に "git" という実行ファイルを置き、PATH を相対エントリ 1 つに
    // する。これが拾われてしまうと、リポジトリの中身が hop の git として実行
    // されてしまう。
    const relativeBin = "tools/bin";
    await mkdir(join(repo.repoPath, relativeBin), { recursive: true });
    await repo.writeFile(join(relativeBin, "git"), "#!/bin/sh\nexit 0\n");
    await chmod(join(repo.repoPath, relativeBin, "git"), EXECUTABLE_MODE);

    // PATH には bun のディレクトリだけを残す (runHop が bun を起動できる最小構成)。
    const result = await runHop(["ls", "--json"], repo.repoPath, {
      ...repo.env,
      PATH: `${relativeBin}:${dirname(process.execPath)}`,
    });

    expect(result.stderr).not.toContain("git executable not found");
    expect(JSON.parse(result.stdout)).toMatchObject({ command: "ls" });
  });
});

describe("git が失敗したときの CLI 契約", () => {
  it("git リポジトリ外では git の fatal を 1 行で出し exit 3", async () => {
    const outside = join(repo.rootDir, "not-a-repo");
    await mkdir(outside, { recursive: true });

    const result = await runHop(["ls"], outside, repo.env);

    expect(result.exitCode).toBe(EXIT_SAFE_REJECTION);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("hop: fatal: not a git repository");
    expect(looksLikeStackTrace(result.stderr)).toBe(false);
  });

  it("--json 付きなら失敗しても JSON エンベロープは返す", async () => {
    const outside = join(repo.rootDir, "not-a-repo-json");
    await mkdir(outside, { recursive: true });

    const result = await runHop(["ls", "--json"], outside, repo.env);

    expect(result.exitCode).toBe(EXIT_SAFE_REJECTION);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schemaVersion: 1,
      command: "ls",
      warnings: [],
    });
    expect(result.stderr).toContain("hop: fatal: not a git repository");
  });
});

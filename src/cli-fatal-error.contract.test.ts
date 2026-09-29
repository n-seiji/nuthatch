import { execFile as execFileCb } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createTestRepo, type TestRepo } from "./testing/repo.ts";

const execFile = promisify(execFileCb);

/**
 * Regression coverage for issue #9: `hop` printed a raw JS stack trace
 * (`ENOENT: no such file or directory, posix_spawn 'git'` plus a Bun frame
 * dump) whenever spawning git failed. These tests launch the real
 * entrypoint as a child process and assert the CLI contract instead: one
 * line on stderr, empty stdout, and the documented exit code — 1 for a
 * missing git binary, 3 for a git failure.
 *
 * They also pin the fix itself: hop resolves git from its own candidate list
 * (PATH, then the usual install dirs), so a PATH that never went through the
 * user's shell profile still finds git.
 */

const CLI_ENTRYPOINT = join(import.meta.dir, "cli.ts");
const EXIT_GENERAL_ERROR = 1;
const EXIT_SAFE_REJECTION = 3;

interface CliRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const runHop = async (
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<CliRunResult> => {
  try {
    const { stdout, stderr } = await execFile("bun", ["run", CLI_ENTRYPOINT, ...args], {
      cwd,
      env,
    });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const { code, stdout, stderr } = error as {
      code?: number;
      stdout: string;
      stderr: string;
    };
    return { exitCode: code ?? 1, stdout, stderr };
  }
};

/** A stack trace shows up as a "at <frame>" line or Bun's version footer. */
const looksLikeStackTrace = (output: string): boolean =>
  /^\s+at\s/mu.test(output) || /^Bun v\d/mu.test(output);

let repo: TestRepo;
let sandbox: string;

beforeEach(async () => {
  repo = await createTestRepo();
  sandbox = await mkdtemp(join(tmpdir(), "nuthatch-fatal-"));
});

afterEach(async () => {
  await repo.cleanup();
  await rm(sandbox, { recursive: true, force: true });
});

describe("git を spawn できないときの CLI 契約", () => {
  it("git が見つからなければ 1 行のエラー + exit 1 (スタックトレースは出さない)", async () => {
    const result = await runHop(["ls"], repo.repoPath, {
      ...repo.env,
      HOP_GIT: join(sandbox, "nowhere", "git"),
    });

    expect(result.exitCode).toBe(EXIT_GENERAL_ERROR);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("hop: git executable not found");
    expect(result.stderr).toContain("HOP_GIT");
    expect(looksLikeStackTrace(result.stderr)).toBe(false);
  });

  it("PATH に git が無くても既知の設置場所から解決して動く", async () => {
    // PATH は bun への symlink だけ (テストが bun を起動できる最小構成)。
    // Git は PATH 経由では絶対に見つからないので、動けばフォールバック解決が
    // 効いていることになる。
    const bunOnlyBin = join(sandbox, "bin");
    await mkdir(bunOnlyBin, { recursive: true });
    await symlink(process.execPath, join(bunOnlyBin, "bun"));

    const result = await runHop(["ls", "--json"], repo.repoPath, {
      ...repo.env,
      PATH: bunOnlyBin,
    });

    expect(result.stderr).not.toContain("git executable not found");
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ command: "ls" });
  });

  it("PATH の相対エントリ配下の git は拾わない (cwd 依存の実行を防ぐ)", async () => {
    // リポジトリ内に "git" という実行ファイルを置き、PATH を相対エントリ 1 つに
    // する。これが拾われてしまうと、リポジトリの中身が hop の git として実行
    // されてしまう。
    const relativeBin = "tools/bin";
    await mkdir(join(repo.repoPath, relativeBin), { recursive: true });
    await repo.writeFile(join(relativeBin, "git"), "#!/bin/sh\nexit 0\n");
    await chmod(join(repo.repoPath, relativeBin, "git"), 0o755);

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
    const outside = join(sandbox, "not-a-repo");
    await mkdir(outside, { recursive: true });

    const result = await runHop(["ls"], outside, repo.env);

    expect(result.exitCode).toBe(EXIT_SAFE_REJECTION);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("hop: fatal: not a git repository");
    expect(looksLikeStackTrace(result.stderr)).toBe(false);
  });
});

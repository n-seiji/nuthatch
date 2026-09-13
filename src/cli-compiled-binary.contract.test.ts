import { execFile as execFileCb } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createTestRepo, type TestRepo } from "./testing/repo.ts";

const execFile = promisify(execFileCb);

/**
 * Regression coverage for the real-world `hop` (no args) breakage: `bun
 * build --compile` binaries append the invocation name to `process.argv`
 * whenever started with no args, regardless of whether stdout is a TTY
 * (see cli-dispatch.ts's normalizeCliArgs doc comment). The shell wrapper
 * (`hop init zsh`) always captures stdout via command substitution, so
 * stdout is a pipe in the real path — this test launches the actual
 * compiled binary the same way (stdout piped, no args) and asserts it
 * doesn't misread the synthesized token as a branch name (which used to
 * fail with "No worktree for branch \"hop\"", exit 3).
 *
 * Building a `--compile` binary is slow, so it's built once in beforeAll
 * and reused across this file's tests. Follows the process-launch style of
 * commands/cli-process.contract.test.ts.
 */

let binaryDir: string;
let binaryPath: string;
let repo: TestRepo;

beforeAll(async () => {
  binaryDir = await mkdtemp(join(tmpdir(), "nuthatch-compiled-"));
  binaryPath = join(binaryDir, "hop");
  await execFile("bun", [
    "build",
    "--compile",
    "--outfile",
    binaryPath,
    join(import.meta.dir, "cli.ts"),
  ]);
});

afterAll(async () => {
  await rm(binaryDir, { recursive: true, force: true });
});

beforeAll(async () => {
  repo = await createTestRepo();
});

afterAll(async () => {
  await repo.cleanup();
});

describe("コンパイル済みバイナリでの `hop` (引数なし) 起動", () => {
  it("stdout がパイプでも、branch 名として誤読して失敗しない", async () => {
    // Wrapper 経由の実運用と同じく stdout だけをパイプで捕まえる。stdin/stderr
    // はデフォルト (execFile ではどちらも非 TTY のパイプになる) — 不具合の再現に
    // 必要なのは「引数なし実行時に argv0 が argv に混入する」ことだけで、TTY か
    // どうかには依存しないため、非 TTY のままで十分再現できる。
    const { stdout, stderr } = await execFile(binaryPath, [], {
      cwd: repo.repoPath,
      env: repo.env,
    });

    expect(stderr).not.toContain('No worktree for branch "hop"');
    expect(stdout + stderr).not.toContain("Re-run with --create");
  });
});

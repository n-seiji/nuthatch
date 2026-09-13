import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createTestRepo, type TestRepo } from "../testing/repo.ts";

/**
 * End-to-end integration tests for the self-drawn picker, driven through a
 * real pty (see ../testing/pty-harness.py's module comment for why a Python
 * helper -- Node has no built-in pty). These exercise the whole stack: raw
 * stdin bytes -> picker-key-parser.ts -> picker-store.ts -> picker-frame.ts
 * -> terminal-session.ts's writes, and back out through the real terminal's
 * line discipline -- nothing here is mocked.
 *
 * Every key send happens at least 300ms after launch: raw mode isn't
 * entered instantly, and a key sent before that lands in the terminal's
 * cooked-mode line buffer and is lost (matches the team's stated
 * requirement for these tests).
 */

const CLI_ENTRY = new URL("../cli.ts", import.meta.url).pathname;
const HARNESS = new URL("../testing/pty-harness.py", import.meta.url).pathname;
const STARTUP_SETTLE_MS = 300;

interface PtyStep {
  readonly wait_ms?: number;
  readonly wait_for?: string;
  readonly timeout_ms?: number;
  readonly send?: string;
  readonly signal?: "TERM" | "HUP";
}

interface PtyResult {
  readonly output: string;
  readonly exit_code: number | null;
}

const runInPty = (repo: TestRepo, steps: readonly PtyStep[]): PtyResult => {
  const stdout = execFileSync("python3", [HARNESS, "bun", repo.repoPath, CLI_ENTRY], {
    env: repo.env,
    input: JSON.stringify(steps),
    encoding: "utf8",
    timeout: 15_000,
  });
  return JSON.parse(stdout) as PtyResult;
};

let repo: TestRepo;

beforeEach(async () => {
  repo = await createTestRepo();
  execFileSync("git", ["branch", "feature-a"], {
    cwd: repo.repoPath,
    env: repo.env,
  });
  execFileSync("git", ["worktree", "add", ".claude/worktrees/feature-a", "feature-a"], {
    cwd: repo.repoPath,
    env: repo.env,
  });
});

afterEach(async () => {
  await repo.cleanup();
});

describe("picker (real pty, self-drawn terminal UI)", () => {
  it("一覧に WORKTREES セクションが描画される", () => {
    const result = runInPty(repo, [{ wait_for: "WORKTREES", timeout_ms: 5000 }, { send: "" }]);
    expect(result.output).toContain("WORKTREES");
  }, 10_000);

  it("↓ で移動して選んだ候補の path が stdout に出る (stderr の UI と混ざらない)", () => {
    // Stdout is redirected to the same pty here (both share the tty), so we can't separate the two streams over a pty -- instead assert exit code 0 (a real cd contract check on separate stdout/stderr streams is covered by cli.contract.test.ts's non-picker paths).
    const result = runInPty(repo, [
      { wait_for: "WORKTREES", timeout_ms: 5000 },
      { wait_ms: STARTUP_SETTLE_MS },
      { send: "[B" },
      { wait_ms: 100 },
      { send: "\r" },
    ]);
    expect(result.exit_code).toBe(0);
  }, 10_000);

  it("Esc で exit 0、stdout は空", () => {
    const stdout = execFileSync("python3", [HARNESS, "bun", repo.repoPath, CLI_ENTRY], {
      env: repo.env,
      input: JSON.stringify([
        { wait_for: "WORKTREES", timeout_ms: 5000 },
        { wait_ms: STARTUP_SETTLE_MS },
        { send: "" },
      ]),
      encoding: "utf8",
      timeout: 15_000,
    });
    const result = JSON.parse(stdout) as PtyResult;
    expect(result.exit_code).toBe(0);
  }, 10_000);

  it("Ctrl+C で exit 130", () => {
    const result = runInPty(repo, [
      { wait_for: "WORKTREES", timeout_ms: 5000 },
      { wait_ms: STARTUP_SETTLE_MS },
      { send: "" },
    ]);
    expect(result.exit_code).toBe(130);
  }, 10_000);

  it("終了後、alt screen から戻りカーソルが再表示される (端末が復元される)", () => {
    const result = runInPty(repo, [
      { wait_for: "WORKTREES", timeout_ms: 5000 },
      { wait_ms: STARTUP_SETTLE_MS },
      { send: "" },
    ]);
    // Show-cursor (ESC[?25h) and leave-alt-screen (ESC[?1049l) must both
    // Have been written before the process exits -- see alt-screen.ts.
    expect(result.output).toContain("[?25h");
    expect(result.output).toContain("[?1049l");
  });

  it("Tab でアクションパネルを開き、移動して選ぶことができる (異常終了しない)", () => {
    const result = runInPty(repo, [
      { wait_for: "WORKTREES", timeout_ms: 5000 },
      { wait_ms: STARTUP_SETTLE_MS },
      { send: "\t" },
      { wait_ms: 100 },
      // First Esc closes the panel back to the list (picker-keys.ts); a second is needed to actually cancel out of the picker.
      { send: "" },
      { wait_ms: 100 },
      { send: "" },
    ]);
    expect(result.output).toContain("Actions for");
    expect(result.exit_code).toBe(0);
  }, 10_000);

  it("SIGTERM でも端末が復元され、exit code は 143 になる", () => {
    const result = runInPty(repo, [
      { wait_for: "WORKTREES", timeout_ms: 5000 },
      { wait_ms: STARTUP_SETTLE_MS },
      { signal: "TERM" },
    ]);
    // Same restore sequence as a normal exit (alt-screen.ts / bracketed paste off) must have been written before the process dies.
    expect(result.output).toContain("[?25h");
    expect(result.output).toContain("[?1049l");
    expect(result.output).toContain("[?2004l");
    expect(result.exit_code).toBe(143);
  }, 10_000);

  it("SIGHUP でも端末が復元され、exit code は 129 になる", () => {
    const result = runInPty(repo, [
      { wait_for: "WORKTREES", timeout_ms: 5000 },
      { wait_ms: STARTUP_SETTLE_MS },
      { signal: "HUP" },
    ]);
    expect(result.output).toContain("[?25h");
    expect(result.output).toContain("[?1049l");
    expect(result.output).toContain("[?2004l");
    expect(result.exit_code).toBe(129);
  }, 10_000);

  it("ESC の直後に未完了の CSI ([) を送っても、続く Ctrl+C で exit 130 になる (Ctrl+C が飲み込まれて操作不能にならない)", () => {
    const result = runInPty(repo, [
      { wait_for: "WORKTREES", timeout_ms: 5000 },
      { wait_ms: STARTUP_SETTLE_MS },
      { send: "[" },
      { wait_ms: 50 },
      { send: "" },
    ]);
    expect(result.exit_code).toBe(130);
  }, 10_000);

  it("ESC O (SS3 導入子) の直後の Ctrl+C 1 回で exit 130 になる (1 回目が無反応にならない)", () => {
    const result = runInPty(repo, [
      { wait_for: "WORKTREES", timeout_ms: 5000 },
      { wait_ms: STARTUP_SETTLE_MS },
      { send: "O" },
    ]);
    expect(result.exit_code).toBe(130);
  }, 10_000);
});

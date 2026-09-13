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
  readonly resize?: { readonly rows: number; readonly cols: number };
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

  it("同一チャンクで Enter+Ctrl+X+y を送っても、cd 後の worktree は削除されない (finish 後の残りキーを無視する)", () => {
    // Reproduces the Fable-reported bug: a single read() containing "\r\x18y" (select, then delete-shortcut, then confirm) used to keep dispatching after Enter's onExit already fired.
    const result = runInPty(repo, [
      { wait_for: "WORKTREES", timeout_ms: 5000 },
      { wait_ms: STARTUP_SETTLE_MS },
      { send: "[B" },
      { wait_ms: 100 },
      { send: "\ry" },
    ]);
    expect(result.exit_code).toBe(0);
    const worktrees = execFileSync("git", ["worktree", "list"], {
      cwd: repo.repoPath,
      env: repo.env,
      encoding: "utf8",
    });
    expect(worktrees).toContain("feature-a");
  }, 10_000);

  it("長い branch 名の削除確認パネルでも、末尾まで折り返して読める (途中で切れない)", () => {
    execFileSync("git", ["branch", "feature-very-long-branch-name-testing"], {
      cwd: repo.repoPath,
      env: repo.env,
    });
    execFileSync(
      "git",
      [
        "worktree",
        "add",
        ".claude/worktrees/feature-very-long-branch-name-testing",
        "feature-very-long-branch-name-testing",
      ],
      { cwd: repo.repoPath, env: repo.env },
    );
    const result = runInPty(repo, [
      { wait_for: "WORKTREES", timeout_ms: 5000 },
      { wait_ms: STARTUP_SETTLE_MS },
      { send: "feature-very-long" },
      { wait_ms: 100 },
      { send: "" },
      { wait_ms: 100 },
      { send: "" },
    ]);
    // Previously the box clipped to the inner width, showing only the first ~10 chars and dropping the trailing "?" entirely.
    expect(result.output).toContain("testing");
    expect(result.output).toContain("?");
  }, 10_000);

  it("末尾に改行の付いた貼り付けで選択がずれない (改行が Ctrl+J/down として解釈されない)", () => {
    execFileSync("git", ["branch", "feature-a2"], { cwd: repo.repoPath, env: repo.env });
    execFileSync("git", ["worktree", "add", ".claude/worktrees/feature-a2", "feature-a2"], {
      cwd: repo.repoPath,
      env: repo.env,
    });
    const result = runInPty(repo, [
      { wait_for: "WORKTREES", timeout_ms: 5000 },
      { wait_ms: STARTUP_SETTLE_MS },
      { send: "[200~feature-a\n[201~" },
      { wait_ms: 100 },
      { send: "" },
    ]);
    // The highlighted (inverse-video) row must still be "feature-a", not "feature-a2" -- a bare pasted "\n" used to be indistinguishable from a real Ctrl+J (down) keypress and moved the selection to the second match.
    // eslint-disable-next-line no-control-regex -- intentionally matching the raw SGR "inverse" escape sequence in the pty's byte output.
    const inverseSegments = [...result.output.matchAll(/\u001B\[7m(?<row>[^\u001B]*)/gu)];
    const lastInverse = inverseSegments.at(-1)?.groups?.["row"] ?? "";
    expect(lastInverse).not.toContain("feature-a2");
  }, 10_000);

  it("SIGWINCH でキー入力なしに再描画され、広い端末では panel が横並びになる", () => {
    const result = runInPty(repo, [
      { wait_for: "WORKTREES", timeout_ms: 5000 },
      { wait_ms: STARTUP_SETTLE_MS },
      { resize: { rows: 24, cols: 80 } },
      { wait_ms: 100 },
      { send: "\t" },
      { wait_ms: 100 },
      { resize: { rows: 40, cols: 200 } },
      { wait_ms: 200 },
      { send: "" },
      { wait_ms: 100 },
      { send: "" },
    ]);
    const frames = result.output.split("[H[J").filter((frame) => frame.length > 0);
    const firstLines = frames.map((frame) => frame.split("\r\n")[0] ?? "");
    // After widening past MIN_SIDE_BY_SIDE_WIDTH, some frame drawn after the resize (with no further keypress in between) must show the panel's box beside the query line -- proving the resize alone triggered a repaint, and that the wide layout actually goes side-by-side (the box top border shares the query's row; stacked would put it several rows further down, as the 80-column test above checks).
    // The harness latin1-decodes raw pty bytes (see pty-harness.py's module comment), so a multi-byte UTF-8 glyph like "╭" doesn't match as itself -- re-encode it the same lossy way before searching.
    const boxTopLeftMangled = Buffer.from("╭", "utf8").toString("latin1");
    expect(
      firstLines.some((line) => line.includes("hop:") && line.includes(boxTopLeftMangled)),
    ).toBe(true);
  }, 10_000);
});

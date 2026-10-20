import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderInit } from "./init.ts";

const commandAvailable = (command: string, args: readonly string[]): boolean => {
  try {
    execFileSync(command, [...args], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

const zshAvailable = commandAvailable("zsh", ["--version"]);
const describeIfZsh = zshAvailable ? describe : describe.skip;
// The wrapper only cds when stdout is a terminal, so those cases need a pty.
const itWithPty = zshAvailable && commandAvailable("python3", ["-c", "import pty"]) ? it : it.skip;

// Runs zsh with a pty as stdout/stdin/stderr (output is the pty's, CR stripped).
const PTY_RUNNER = [
  "import os, pty, sys",
  "status = pty.spawn(['zsh', '-c', sys.argv[1]])",
  "sys.exit(os.waitstatus_to_exitcode(status))",
].join("\n");

interface ZshResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly status: number;
}

describeIfZsh("hop init zsh (real zsh)", () => {
  let workDir: string;
  let fakeBinDir: string;
  let targetDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "nuthatch-zsh-"));
    fakeBinDir = join(workDir, "bin");
    targetDir = join(workDir, "target-worktree");
    await mkdir(fakeBinDir, { recursive: true });
    await mkdir(targetDir, { recursive: true });

    // Stub out the real `hop` binary: always "succeeds" by printing a path,
    // So we can drive the shell wrapper without a real git repo.
    const fakeHopPath = join(fakeBinDir, "hop");
    await writeFile(fakeHopPath, `#!/bin/sh\necho "${targetDir}"\nexit 0\n`);
    await chmod(fakeHopPath, 0o755);
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  const run = (command: string, args: readonly string[]): ZshResult => {
    try {
      const stdout = execFileSync(command, [...args], {
        env: { ...process.env, PATH: `${fakeBinDir}:${process.env.PATH}` },
        encoding: "utf8",
      });
      return { stdout: stdout.replaceAll("\r", ""), stderr: "", status: 0 };
    } catch (error) {
      const err = error as {
        stdout?: string;
        stderr?: string;
        status?: number;
      };
      return {
        stdout: (err.stdout ?? "").replaceAll("\r", ""),
        stderr: err.stderr ?? "",
        status: err.status ?? 1,
      };
    }
  };

  const runInZsh = (script: string): ZshResult => run("zsh", ["-c", `${renderInit()}\n${script}`]);

  const runInZshWithPty = (script: string): ZshResult =>
    run("python3", ["-I", "-c", PTY_RUNNER, `${renderInit()}\n${script}`]);

  itWithPty("`status` を local 変数として使わず read-only variable エラーを起こさない", () => {
    const result = runInZshWithPty("hop feat/demo");
    expect(result.stdout).not.toContain("read-only variable");
    expect(result.status).toBe(0);
  });

  itWithPty("`hop -- <branch>` は予約語エスケープでも cd される", () => {
    const result = runInZshWithPty("hop -- ls; pwd");
    expect(result.stdout).not.toContain("read-only variable");
    expect(result.stdout.trim().split("\n").at(-1)).toBe(targetDir);
  });

  it("`hop ls` (予約語そのもの) は cd されない", () => {
    const before = workDir;
    const result = runInZsh(`cd ${before} && hop ls > /dev/null; pwd`);
    expect(result.stdout.trim()).toBe(before);
  });

  itWithPty("stdin が tty でない bare `hop` は cd しない", () => {
    const before = workDir;
    const result = runInZshWithPty(`cd ${before} && hop < /dev/null; pwd`);
    expect(result.stdout.trim().split("\n").at(-1)).toBe(before);
  });

  it("stdout が tty でない `$(hop ...)` はパスを出力する (cd せず空にならない)", () => {
    const result = runInZsh('p=$(hop feat/demo --create); print -r -- "p=$p"');
    expect(result.stdout.trim()).toBe(`p=${targetDir}`);
  });

  it("stdout が tty でない `hop` はカレントディレクトリを変えない", () => {
    const before = workDir;
    const result = runInZsh(`cd ${before} && hop feat/demo > /dev/null; pwd`);
    expect(result.stdout.trim()).toBe(before);
  });
});

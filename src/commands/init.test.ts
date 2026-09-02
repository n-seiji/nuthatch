import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderInit } from "./init.ts";

const hasZsh = (): boolean => {
  try {
    execFileSync("zsh", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

const zshAvailable = hasZsh();
const describeIfZsh = zshAvailable ? describe : describe.skip;

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

  const runInZsh = (script: string): { stdout: string; stderr: string; status: number } => {
    const init = renderInit({ shell: "zsh" });
    try {
      const stdout = execFileSync("zsh", ["-c", `${init}\n${script}`], {
        env: { ...process.env, PATH: `${fakeBinDir}:${process.env.PATH}` },
        encoding: "utf8",
      });
      return { stdout, stderr: "", status: 0 };
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; status?: number };
      return {
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? "",
        status: err.status ?? 1,
      };
    }
  };

  it("`status` を local 変数として使わず read-only variable エラーを起こさない", () => {
    const result = runInZsh("hop feat/demo");
    expect(result.stderr).not.toContain("read-only variable");
    expect(result.status).toBe(0);
  });

  it("`hop -- <branch>` は予約語エスケープでも cd される", () => {
    const result = runInZsh("hop -- ls; pwd");
    expect(result.stderr).not.toContain("read-only variable");
    expect(result.stdout.trim()).toBe(targetDir);
  });

  it("`hop ls` (予約語そのもの) は cd されない", () => {
    const before = workDir;
    const result = runInZsh(`cd ${before} && hop ls > /dev/null; pwd`);
    expect(result.stdout.trim()).toBe(before);
  });
});

import { describe, expect, it } from "bun:test";
import { describeFatalError } from "./fatal-error.ts";
import { GIT_NOT_FOUND_ERROR_CODE } from "./git-executable.ts";
import { EXIT_GENERAL_ERROR, EXIT_SAFE_REJECTION } from "./result.ts";

const execError = (fields: Record<string, unknown>): unknown =>
  Object.assign(new Error("Command failed: git status"), fields);

describe("describeFatalError", () => {
  it("git が見つからないエラーはメッセージをそのまま出し、汎用エラー (1) にする", () => {
    const error = Object.assign(new Error("git executable not found. Looked in: /usr/bin/git."), {
      code: GIT_NOT_FOUND_ERROR_CODE,
    });

    expect(describeFatalError(error)).toEqual({
      message: "git executable not found. Looked in: /usr/bin/git.",
      exitCode: EXIT_GENERAL_ERROR,
    });
  });

  it("spawn ENOENT (issue #9 のスタックトレース) は次の一手付きの 1 行に変える", () => {
    const report = describeFatalError(
      execError({ code: "ENOENT", syscall: "spawn git", path: "git" }),
    );

    expect(report.exitCode).toBe(EXIT_GENERAL_ERROR);
    expect(report.message).toContain("git");
    expect(report.message).toContain("HOP_GIT");
    expect(report.message).not.toContain("\n");
  });

  it("git の非ゼロ終了は stderr を見せて安全側拒否 (3) にする", () => {
    const report = describeFatalError(
      execError({
        code: 128,
        stderr: "fatal: not a git repository (or any of the parent directories): .git\n",
      }),
    );

    expect(report).toEqual({
      message: "fatal: not a git repository (or any of the parent directories): .git",
      exitCode: EXIT_SAFE_REJECTION,
    });
  });

  it("stderr が空の git 失敗では Error のメッセージにフォールバックする", () => {
    const report = describeFatalError(execError({ code: 128, stderr: "   " }));

    expect(report).toEqual({
      message: "Command failed: git status",
      exitCode: EXIT_SAFE_REJECTION,
    });
  });

  it("シグナルで落ちた git も 3 にする", () => {
    const report = describeFatalError(execError({ code: null, signal: "SIGKILL", stderr: "" }));

    expect(report.exitCode).toBe(EXIT_SAFE_REJECTION);
  });

  it("その他の Error は message をそのまま 1 で返す", () => {
    expect(describeFatalError(new Error("boom"))).toEqual({
      message: "boom",
      exitCode: EXIT_GENERAL_ERROR,
    });
  });

  it("Error 以外が throw されても文字列化して 1 で返す", () => {
    expect(describeFatalError("just a string")).toEqual({
      message: "just a string",
      exitCode: EXIT_GENERAL_ERROR,
    });
  });
});

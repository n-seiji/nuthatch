import { describe, expect, it } from "bun:test";
import { parsePorcelain } from "./porcelain.ts";

const record = (lines: readonly string[]): string => `${lines.join("\0")}\0`;

describe("parsePorcelain", () => {
  it("空文字列の場合、空配列を返す", () => {
    expect(parsePorcelain("")).toEqual([]);
  });

  it("通常のワークツリーを持つ場合、branch と head を抽出する", () => {
    const output = record(["worktree /repo", "HEAD abc123", "branch refs/heads/main"]);
    expect(parsePorcelain(output)).toEqual([
      {
        path: "/repo",
        head: "abc123",
        branch: "main",
        detached: false,
        bare: false,
        locked: false,
        lockReason: null,
        prunable: false,
        prunableReason: null,
      },
    ]);
  });

  it("detached HEAD の場合、branch は null で detached が true になる", () => {
    const output = record(["worktree /repo/wt", "HEAD def456", "detached"]);
    const [wt] = parsePorcelain(output);
    expect(wt?.branch).toBeNull();
    expect(wt?.detached).toBe(true);
  });

  it("理由付き locked の場合、lockReason を保持する", () => {
    const output = record([
      "worktree /repo/wt",
      "HEAD abc",
      "branch refs/heads/feat",
      "locked in use by CI",
    ]);
    const [wt] = parsePorcelain(output);
    expect(wt?.locked).toBe(true);
    expect(wt?.lockReason).toBe("in use by CI");
  });

  it("理由なし locked の場合、lockReason は null になる", () => {
    const output = record(["worktree /repo/wt", "HEAD abc", "branch refs/heads/feat", "locked"]);
    const [wt] = parsePorcelain(output);
    expect(wt?.locked).toBe(true);
    expect(wt?.lockReason).toBeNull();
  });

  it("prunable の場合、理由を保持する", () => {
    const output = record(["worktree /repo/wt", "HEAD abc", "prunable gitdir file missing"]);
    const [wt] = parsePorcelain(output);
    expect(wt?.prunable).toBe(true);
    expect(wt?.prunableReason).toBe("gitdir file missing");
  });

  it("bare リポジトリの場合、bare が true で HEAD/branch は欠損しうる", () => {
    const output = record(["worktree /repo", "bare"]);
    const [wt] = parsePorcelain(output);
    expect(wt?.bare).toBe(true);
    expect(wt?.head).toBeNull();
    expect(wt?.branch).toBeNull();
  });

  it("空白や Unicode を含む path をそのまま保持する", () => {
    const output = record(["worktree /repo/my worktree/日本語パス", "HEAD abc"]);
    const [wt] = parsePorcelain(output);
    expect(wt?.path).toBe("/repo/my worktree/日本語パス");
  });

  it("未知のフィールドは無視して残りを解析する", () => {
    const output = record(["worktree /repo/wt", "HEAD abc", "future-field some-value"]);
    const [wt] = parsePorcelain(output);
    expect(wt?.path).toBe("/repo/wt");
    expect(wt?.head).toBe("abc");
  });

  it("worktree path が欠損したレコードは除外する", () => {
    const output = record(["HEAD abc", "branch refs/heads/main"]);
    expect(parsePorcelain(output)).toEqual([]);
  });

  it("複数レコードをすべて解析する", () => {
    const output = [
      ["worktree /repo", "HEAD abc", "branch refs/heads/main"].join("\0"),
      ["worktree /repo/wt2", "HEAD def", "branch refs/heads/feat"].join("\0"),
    ].join("\0\0");
    const result = parsePorcelain(output);
    expect(result).toHaveLength(2);
    expect(result[0]?.path).toBe("/repo");
    expect(result[1]?.path).toBe("/repo/wt2");
  });
});

import { describe, expect, it } from "bun:test";
import { filterOutNestedWorktreeStatus, isDirtyFromStatus } from "./dirty.ts";

describe("filterOutNestedWorktreeStatus", () => {
  it("他 worktree の path と一致するエントリを除外する", () => {
    const lines = ["?? .claude/worktrees/x/"];
    const filtered = filterOutNestedWorktreeStatus(lines, "/repo", ["/repo/.claude/worktrees/x"]);
    expect(filtered).toEqual([]);
  });

  it("他 worktree の path 配下にネストしたエントリを除外する", () => {
    const lines = ["?? .claude/worktrees/x/some-file.txt"];
    const filtered = filterOutNestedWorktreeStatus(lines, "/repo", ["/repo/.claude/worktrees/x"]);
    expect(filtered).toEqual([]);
  });

  it("他 worktree と無関係な変更は除外しない", () => {
    const lines = [" M src/index.ts", "?? .claude/worktrees/x/"];
    const filtered = filterOutNestedWorktreeStatus(lines, "/repo", ["/repo/.claude/worktrees/x"]);
    expect(filtered).toEqual([" M src/index.ts"]);
  });

  it("前方一致だが別 dir (境界違反) は除外しない (/a/foo は /a/f の配下ではない)", () => {
    const lines = ["?? foo/bar.txt"];
    const filtered = filterOutNestedWorktreeStatus(lines, "/a", ["/a/f"]);
    expect(filtered).toEqual(["?? foo/bar.txt"]);
  });

  it("rename エントリは新パス側で判定する", () => {
    const lines = ["R  old.txt -> .claude/worktrees/x/new.txt"];
    const filtered = filterOutNestedWorktreeStatus(lines, "/repo", ["/repo/.claude/worktrees/x"]);
    expect(filtered).toEqual([]);
  });

  it("otherWorktreePaths が空の場合は何も除外しない", () => {
    const lines = ["?? .claude/worktrees/x/"];
    const filtered = filterOutNestedWorktreeStatus(lines, "/repo", []);
    expect(filtered).toEqual(lines);
  });

  it("otherWorktreePaths に target 自身が含まれても無視する", () => {
    const lines = [" M src/index.ts"];
    const filtered = filterOutNestedWorktreeStatus(lines, "/repo", ["/repo"]);
    expect(filtered).toEqual([" M src/index.ts"]);
  });

  it("quote された path も unquote して判定する", () => {
    const lines = ['?? ".claude/worktrees/x/日本語.txt"'];
    const filtered = filterOutNestedWorktreeStatus(lines, "/repo", ["/repo/.claude/worktrees/x"]);
    expect(filtered).toEqual([]);
  });
});

describe("isDirtyFromStatus", () => {
  it("ネストした worktree の変更のみの場合、dirty ではない", () => {
    const status = "?? .claude/worktrees/x/\n";
    expect(isDirtyFromStatus(status, "/repo", ["/repo/.claude/worktrees/x"])).toBe(false);
  });

  it("ネストした worktree に加えて自分自身の変更がある場合、dirty と判定する", () => {
    const status = " M src/index.ts\n?? .claude/worktrees/x/\n";
    expect(isDirtyFromStatus(status, "/repo", ["/repo/.claude/worktrees/x"])).toBe(true);
  });

  it("status が空文字列の場合、dirty ではない", () => {
    expect(isDirtyFromStatus("", "/repo", [])).toBe(false);
  });
});

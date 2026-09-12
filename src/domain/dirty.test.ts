import { describe, expect, it } from "bun:test";
import { filterOutNestedWorktreePaths, isDirtyFromStatus, parseStatusPaths } from "./dirty.ts";

describe("filterOutNestedWorktreePaths", () => {
  it("他 worktree の path と一致するエントリを除外する", () => {
    const paths = [".claude/worktrees/x"];
    const filtered = filterOutNestedWorktreePaths(paths, "/repo", ["/repo/.claude/worktrees/x"]);
    expect(filtered).toEqual([]);
  });

  it("他 worktree の path 配下にネストしたエントリを除外する", () => {
    const paths = [".claude/worktrees/x/some-file.txt"];
    const filtered = filterOutNestedWorktreePaths(paths, "/repo", ["/repo/.claude/worktrees/x"]);
    expect(filtered).toEqual([]);
  });

  it("他 worktree と無関係な変更は除外しない", () => {
    const paths = ["src/index.ts", ".claude/worktrees/x"];
    const filtered = filterOutNestedWorktreePaths(paths, "/repo", ["/repo/.claude/worktrees/x"]);
    expect(filtered).toEqual(["src/index.ts"]);
  });

  it("前方一致だが別 dir (境界違反) は除外しない (/a/foo は /a/f の配下ではない)", () => {
    const paths = ["foo/bar.txt"];
    const filtered = filterOutNestedWorktreePaths(paths, "/a", ["/a/f"]);
    expect(filtered).toEqual(["foo/bar.txt"]);
  });

  it("otherWorktreePaths が空の場合は何も除外しない", () => {
    const paths = [".claude/worktrees/x"];
    const filtered = filterOutNestedWorktreePaths(paths, "/repo", []);
    expect(filtered).toEqual(paths);
  });

  it("otherWorktreePaths に target 自身が含まれても無視する", () => {
    const paths = ["src/index.ts"];
    const filtered = filterOutNestedWorktreePaths(paths, "/repo", ["/repo"]);
    expect(filtered).toEqual(["src/index.ts"]);
  });

  it("非 ASCII path もそのまま (デコード不要で) 判定できる", () => {
    const paths = [".claude/worktrees/x/日本語.txt"];
    const filtered = filterOutNestedWorktreePaths(paths, "/repo", ["/repo/.claude/worktrees/x"]);
    expect(filtered).toEqual([]);
  });
});

describe("parseStatusPaths", () => {
  it("通常のエントリ (XY PATH + NUL) から path を取り出す", () => {
    expect(parseStatusPaths("?? .claude/worktrees/x/\0")).toEqual([".claude/worktrees/x/"]);
  });

  it("複数エントリを順に取り出す", () => {
    expect(parseStatusPaths(" M src/index.ts\0?? .claude/worktrees/x/\0")).toEqual([
      "src/index.ts",
      ".claude/worktrees/x/",
    ]);
  });

  it("rename エントリは新パス側のみを返し、旧パスのレコードは消費して捨てる", () => {
    // `-z` 形式では rename は `XY new_path\0 old_path\0` という 2 レコード。
    // 旧パスは containment 判定に無関係で、次のエントリとして誤読しては
    // ならない。
    expect(parseStatusPaths("R  .claude/worktrees/x/new.txt\0old.txt\0")).toEqual([
      ".claude/worktrees/x/new.txt",
    ]);
  });

  it("非 ASCII path は core.quotePath の 8 進エスケープを受けずそのまま出る", () => {
    // Core.quotePath=true (既定) でも -z 使用時は quote/escape されない —
    // これが -z を選ぶ理由そのもの (旧 --porcelain 形式は
    // "\346\227\245..." のような 8 進エスケープを出し、unquote だけの実装
    // ではデコードできなかった)。
    expect(parseStatusPaths("?? .claude/worktrees/日本語/\0")).toEqual([
      ".claude/worktrees/日本語/",
    ]);
  });

  it("空文字列からは何も取り出さない", () => {
    expect(parseStatusPaths("")).toEqual([]);
  });
});

describe("isDirtyFromStatus", () => {
  it("ネストした worktree の変更のみの場合、dirty ではない", () => {
    const status = "?? .claude/worktrees/x/\0";
    expect(isDirtyFromStatus(status, "/repo", ["/repo/.claude/worktrees/x"])).toBe(false);
  });

  it("ネストした worktree に加えて自分自身の変更がある場合、dirty と判定する", () => {
    const status = " M src/index.ts\0?? .claude/worktrees/x/\0";
    expect(isDirtyFromStatus(status, "/repo", ["/repo/.claude/worktrees/x"])).toBe(true);
  });

  it("status が空文字列の場合、dirty ではない", () => {
    expect(isDirtyFromStatus("", "/repo", [])).toBe(false);
  });

  it("非 ASCII path を持つネストした worktree の変更のみの場合、dirty ではない (8 進エスケープ問題の回帰確認)", () => {
    const status = "?? .claude/worktrees/日本語/\0";
    expect(isDirtyFromStatus(status, "/repo", ["/repo/.claude/worktrees/日本語"])).toBe(false);
  });
});

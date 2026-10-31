import { describe, expect, it } from "bun:test";
import { displayWidth } from "../domain/display-width.ts";
import { footerLine, headerLine, ruleLine } from "./picker-chrome.ts";
import { lineWidth, renderLine } from "./picker-frame.ts";
import { creatableCandidate, worktreeCandidate } from "./picker-layout.fixtures.ts";

const text = (line: Parameters<typeof renderLine>[0]): string => renderLine(line, false);

describe("headerLine", () => {
  const candidates = [
    worktreeCandidate({ kind: "root", path: "/home/me/ghq/github.com/me/app" }, false),
    worktreeCandidate({ branch: "feat/a" }, true),
    worktreeCandidate({ branch: "feat/b" }, false),
    creatableCandidate("feat/c", "remote"),
  ];

  it("root のリポジトリ名と、worktree 数・変更あり数・branch 数を出す", () => {
    expect(text(headerLine(candidates, null))).toBe(
      "◆ app  3 worktrees · 1 with changes · 1 branch",
    );
  });

  it("絞り込み中は一致件数を足す", () => {
    expect(text(headerLine(candidates, 2))).toBe(
      "◆ app  3 worktrees · 1 with changes · 1 branch · 2 matches",
    );
  });

  it("変更あり・branch が 0 件なら出さない", () => {
    const only = [worktreeCandidate({ kind: "root", path: "/home/me/app" }, false)];
    expect(text(headerLine(only, null))).toBe("◆ app  1 worktree");
  });

  it("変更ありは黄色で目立たせる", () => {
    expect(headerLine(candidates, null)).toContainEqual({
      text: "1 with changes",
      style: "yellow",
    });
  });
});

describe("ruleLine", () => {
  it("見出しの後ろを罫線で幅いっぱいまで埋める", () => {
    const line = ruleLine("WORKTREES", 20);
    expect(text(line)).toBe("WORKTREES ──────────");
    expect(lineWidth(line)).toBe(20);
  });

  it("幅が見出しより狭くても見出しは欠けない", () => {
    expect(text(ruleLine("WORKTREES", 3))).toBe("WORKTREES ");
  });
});

describe("footerLine", () => {
  it("キーを太字、説明を薄く、元のヒントと同じ文字列になる", () => {
    const hint = "↑↓ move · Enter cd · Esc cancel";
    const line = footerLine(hint);
    expect(text(line)).toBe(hint);
    expect(displayWidth(text(line))).toBe(displayWidth(hint));
    expect(line).toContainEqual({ text: "Enter", style: "bold" });
    expect(line).toContainEqual({ text: " cd", style: "dim" });
  });

  it("複数キーを / でつないだ表記も 1 つのキーとして太字にする", () => {
    expect(footerLine("Tab/→/Ctrl+L actions")).toEqual([
      { text: "Tab/→/Ctrl+L", style: "bold" },
      { text: " actions", style: "dim" },
    ]);
  });
});

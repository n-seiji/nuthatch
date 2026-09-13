import { describe, expect, it } from "bun:test";
import {
  displayWidth,
  graphemes,
  padToWidth,
  truncateToWidth,
  truncateToWidthKeepingTail,
} from "./display-width.ts";

describe("displayWidth", () => {
  it("ASCII は 1 文字 1 幅", () => {
    expect(displayWidth("feat/add-x")).toBe(10);
  });

  it("日本語 (CJK) は 1 文字 2 幅", () => {
    expect(displayWidth("機能追加")).toBe(8);
  });

  it("ASCII と日本語が混在するブランチ名でも正しく合算する", () => {
    expect(displayWidth("feat/日本語-branch")).toBe(
      displayWidth("feat/") + displayWidth("日本語") + displayWidth("-branch"),
    );
    expect(displayWidth("feat/日本語-branch")).toBe(5 + 6 + 7);
  });

  it("結合文字 (combining mark) は幅 0 で、直前の書記素に吸収される", () => {
    const eWithCombiningAcute = "é"; // "é" as base + U+0301
    expect(displayWidth(eWithCombiningAcute)).toBe(1);
    expect(graphemes(eWithCombiningAcute)).toEqual([eWithCombiningAcute]);
  });

  it("異体字セレクタは幅 0 で書記素を分割しない", () => {
    // U+2764 (heart) + U+FE0F (VS16, emoji presentation) as one cluster.
    const heartEmoji = "❤️";
    expect(graphemes(heartEmoji)).toEqual([heartEmoji]);
  });

  it("ZWJ 絵文字は 1 つの書記素として扱われ、幅は絵文字ブロックとして計算される", () => {
    // Family emoji: man + ZWJ + woman + ZWJ + girl + ZWJ + boy.
    const familyEmoji = "\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}";
    const clusters = graphemes(familyEmoji);
    expect(clusters).toEqual([familyEmoji]);
    expect(displayWidth(familyEmoji)).toBe(2);
  });
});

describe("padToWidth", () => {
  it("幅が足りない分だけ半角スペースを右側に追加する", () => {
    expect(padToWidth("ab", 5)).toBe("ab   ");
  });

  it("全角文字を含む文字列は表示幅ベースで揃う (.length ベースなら過剰にパディングされてしまう)", () => {
    const wide = padToWidth("日本語", 10); // DisplayWidth "日本語" = 6
    expect(displayWidth(wide)).toBe(10);
    expect(wide).toBe("日本語    ");
  });

  it("すでに幅以上なら変更しない", () => {
    expect(padToWidth("日本語", 4)).toBe("日本語");
  });

  it("2 つのラベルを同じ width にパディングすると表示幅が揃う (桁揃えの本質的なテスト)", () => {
    const width = Math.max(displayWidth("feat/x"), displayWidth("機能/追加する")) + 2;
    const a = padToWidth("feat/x", width);
    const b = padToWidth("機能/追加する", width);
    expect(displayWidth(a)).toBe(width);
    expect(displayWidth(b)).toBe(width);
  });
});

describe("truncateToWidth", () => {
  it("幅以内ならそのまま返す", () => {
    expect(truncateToWidth("short", 10)).toBe("short");
  });

  it("超過分を末尾から省略記号に置き換える", () => {
    expect(truncateToWidth("abcdefgh", 5)).toBe("abcd…");
    expect(displayWidth(truncateToWidth("abcdefgh", 5))).toBeLessThanOrEqual(5);
  });

  it("全角文字を含む文字列でも書記素の途中で切らない", () => {
    const result = truncateToWidth("機能追加のテスト", 5);
    // Each CJK grapheme is width 2; budget for content is 5 - 1(ellipsis) = 4.
    expect(result).toBe("機能…");
    expect(displayWidth(result)).toBeLessThanOrEqual(5);
  });

  it("結合文字を含む書記素をちょうど境界で切っても壊れない", () => {
    const eWithCombiningAcute = "é";
    const value = `${eWithCombiningAcute}bcdef`;
    const result = truncateToWidth(value, 3).replace("…", "");
    expect(graphemes(result).every((grapheme) => graphemes(value).includes(grapheme))).toBe(true);
  });

  it("省略記号すら入らない幅では空文字を返す", () => {
    expect(truncateToWidth("abcdef", 0)).toBe("");
  });
});

describe("truncateToWidthKeepingTail", () => {
  it("幅以内ならそのまま返す", () => {
    expect(truncateToWidthKeepingTail("short", 10)).toBe("short");
  });

  it("超過分を先頭から省略記号に置き換え、末尾を保持する (パス表示向け)", () => {
    const result = truncateToWidthKeepingTail("/very/long/path/to/repo", 10);
    expect(result.startsWith("…")).toBe(true);
    expect(result.endsWith("repo")).toBe(true);
    expect(displayWidth(result)).toBeLessThanOrEqual(10);
  });

  it("全角文字を含むパスでも書記素の途中で切らない", () => {
    const result = truncateToWidthKeepingTail("/ghq/日本語プロジェクト/repo", 10);
    expect(displayWidth(result)).toBeLessThanOrEqual(10);
    for (const grapheme of graphemes(result.replace("…", ""))) {
      expect(graphemes("/ghq/日本語プロジェクト/repo")).toContain(grapheme);
    }
  });
});

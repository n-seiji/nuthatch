import { describe, expect, it } from "bun:test";
import { buildFrame, type StyledLine, wrapInBox } from "./picker-frame.ts";

const line = (text: string): StyledLine => [{ text }];

describe("buildFrame", () => {
  it("常にカーソルホーム+画面末尾までクリアしてから描画する (行が減っても残像が残らない)", () => {
    const frame = buildFrame({
      left: [line("a"), line("b"), line("c")],
      right: null,
      stacked: false,
      colorEnabled: false,
    });
    expect(frame.startsWith("[H[J")).toBe(true);
    expect(frame).toContain("a\r\nb\r\nc");

    const shrunk = buildFrame({
      left: [line("a")],
      right: null,
      stacked: false,
      colorEnabled: false,
    });
    expect(shrunk.startsWith("[H[J")).toBe(true);
    expect(shrunk).not.toContain("b");
  });

  it("パネルがある場合は 2 カラムで横に並べる", () => {
    const frame = buildFrame({
      left: [line("row1"), line("row2")],
      right: [line("panel1")],
      stacked: false,
      colorEnabled: false,
    });
    const lines = frame.replace("[H[J", "").split("\r\n");
    expect(lines[0]).toContain("row1");
    expect(lines[0]).toContain("panel1");
    expect(lines[1]?.trimEnd()).toBe("row2");
  });

  it("stacked のときはパネルをリストの下に積む", () => {
    const frame = buildFrame({
      left: [line("row1")],
      right: [line("panel1")],
      stacked: true,
      colorEnabled: false,
    });
    const lines = frame.replace("[H[J", "").split("\r\n");
    expect(lines).toEqual(["row1", "panel1"]);
  });

  it("colorEnabled=false のときは SGR コードを一切出力しない", () => {
    const frame = buildFrame({
      left: [[{ text: "selected", style: "inverse" }]],
      right: null,
      stacked: false,
      colorEnabled: false,
    });
    expect(frame).not.toContain("[7m");
    expect(frame).toContain("selected");
  });

  it("colorEnabled=true のときは指定したスタイルの SGR コードを出力する", () => {
    const frame = buildFrame({
      left: [[{ text: "branch", style: "cyan" }]],
      right: null,
      stacked: false,
      colorEnabled: true,
    });
    expect(frame).toContain("[36m");
    expect(frame).toContain("[0m");
  });

  it("全角文字を含む行でも 2 カラムの桁揃えが display width 基準になる", () => {
    const frame = buildFrame({
      left: [line("あ"), line("bb")],
      right: [line("R")],
      stacked: false,
      colorEnabled: false,
    });
    const lines = frame.replace("[H[J", "").split("\r\n");
    // Both candidate labels are 2 display columns wide, so the gutter (and the right column) lines up at the same character position in both rows.
    expect(lines[0]).toBe("あ  R");
    expect(lines[1]?.trimEnd()).toBe("bb");
  });
});

describe("wrapInBox", () => {
  it("角丸罫線でコンテンツを囲む", () => {
    const boxed = wrapInBox([line("hi")], 10);
    const rendered = boxed.map((row) => row.map((span) => span.text).join(""));
    expect(rendered[0]?.startsWith("╭")).toBe(true);
    expect(rendered[0]?.endsWith("╮")).toBe(true);
    expect(rendered.at(-1)?.startsWith("╰")).toBe(true);
    expect(rendered[1]).toContain("hi");
  });

  it("内側の幅に収まらない行はクリップしてボーダーからはみ出さない", () => {
    const boxed = wrapInBox([line("a very very long line of text")], 12);
    const widths = new Set(
      boxed.map((row) => row.reduce((total, span) => total + span.text.length, 0)),
    );
    expect(widths.size).toBe(1);
  });
});

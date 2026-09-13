import { describe, expect, it } from "bun:test";
import { PickerKeyParser } from "./picker-key-parser.ts";

const feed = (parser: PickerKeyParser, text: string) => parser.feed(Buffer.from(text, "latin1"));

describe("PickerKeyParser", () => {
  it("Enter (CR) を return として認識する", () => {
    const parser = new PickerKeyParser();
    const events = feed(parser, "\r");
    expect(events).toEqual([{ input: "", key: expect.objectContaining({ return: true }) }]);
  });

  it(String.raw`Ctrl+J (LF) を down 相当の \n として認識する (Enter とは区別する)`, () => {
    const parser = new PickerKeyParser();
    const events = feed(parser, "\n");
    expect(events[0]?.input).toBe("\n");
    expect(events[0]?.key.return).toBe(false);
  });

  it("Tab を認識する", () => {
    const parser = new PickerKeyParser();
    const events = feed(parser, "\t");
    expect(events[0]?.key.tab).toBe(true);
  });

  it("Backspace (0x7f) を認識する", () => {
    const parser = new PickerKeyParser();
    const events = feed(parser, "\u007F");
    expect(events[0]?.key.backspace).toBe(true);
  });

  it("Ctrl+H (0x08) を backspace として認識する (ctrl フラグは立てない)", () => {
    const parser = new PickerKeyParser();
    const events = feed(parser, "\u0008");
    expect(events[0]?.key.backspace).toBe(true);
    expect(events[0]?.key.ctrl).toBe(false);
  });

  it("Ctrl+英字 (0x01-0x1A、上記の例外を除く) を ctrl+char として認識する", () => {
    const parser = new PickerKeyParser();
    const ctrlC = feed(parser, "\u0003");
    expect(ctrlC[0]).toEqual({
      input: "c",
      key: expect.objectContaining({ ctrl: true }),
    });
    const ctrlP = feed(parser, "\u0010");
    expect(ctrlP[0]?.input).toBe("p");
    const ctrlX = feed(parser, "\u0018");
    expect(ctrlX[0]?.input).toBe("x");
  });

  it("矢印キー (ESC[A-D) を認識する", () => {
    const parser = new PickerKeyParser();
    expect(feed(parser, "\u001B[A")[0]?.key.upArrow).toBe(true);
    expect(feed(parser, "\u001B[B")[0]?.key.downArrow).toBe(true);
    expect(feed(parser, "\u001B[C")[0]?.key.rightArrow).toBe(true);
    expect(feed(parser, "\u001B[D")[0]?.key.leftArrow).toBe(true);
  });

  it("application cursor mode の矢印キー (ESC O A-D) を認識する", () => {
    const parser = new PickerKeyParser();
    expect(feed(parser, "\u001BOA")[0]?.key.upArrow).toBe(true);
    expect(feed(parser, "\u001BOB")[0]?.key.downArrow).toBe(true);
  });

  it("修飾付き CSI (ESC[1;5A = Ctrl+↑) を認識する", () => {
    const parser = new PickerKeyParser();
    const events = feed(parser, "\u001B[1;5A");
    expect(events[0]?.key.upArrow).toBe(true);
    expect(events[0]?.key.ctrl).toBe(true);
  });

  it("Delete (ESC[3~) を認識する", () => {
    const parser = new PickerKeyParser();
    const events = feed(parser, "\u001B[3~");
    expect(events[0]?.key.delete).toBe(true);
  });

  it("Alt+文字 (ESC 接頭辞) を meta 付き char として認識する", () => {
    const parser = new PickerKeyParser();
    const events = feed(parser, "\u001Bx");
    expect(events[0]).toEqual({
      input: "x",
      key: expect.objectContaining({ meta: true }),
    });
  });

  it("未知のエスケープ列は破棄され、途中から通常文字として流れない", () => {
    const parser = new PickerKeyParser();
    // ESC[99Z is not a sequence this parser recognizes.
    const events = feed(parser, "\u001B[99Za");
    expect(events).toEqual([{ input: "a", key: expect.objectContaining({}) }]);
  });

  it("チャンク境界で分割されたエスケープ列を正しく結合する", () => {
    const parser = new PickerKeyParser();
    expect(parser.feed(Buffer.from("\u001B[", "latin1"))).toEqual([]);
    const events = parser.feed(Buffer.from("A", "latin1"));
    expect(events[0]?.key.upArrow).toBe(true);
  });

  it("チャンク境界で分割された UTF-8 の途中バイトを正しく結合する", () => {
    const parser = new PickerKeyParser();
    const bytes = Buffer.from("あ", "utf8");
    expect(bytes.length).toBeGreaterThan(1);
    const first = parser.feed(bytes.subarray(0, 1));
    expect(first).toEqual([]);
    const rest = parser.feed(bytes.subarray(1));
    expect(rest[0]?.input).toBe("あ");
  });

  it("1 チャンクに複数キーが含まれる場合すべて分解する", () => {
    const parser = new PickerKeyParser();
    const events = feed(parser, "ab\r");
    expect(events.map((keyEvent) => keyEvent.input)).toEqual(["a", "b", ""]);
    expect(events[2]?.key.return).toBe(true);
  });

  it("単独 ESC は feed() だけでは確定しない (hasPendingEscape で分かる)", () => {
    const parser = new PickerKeyParser();
    const events = feed(parser, "\u001B");
    expect(events).toEqual([]);
    expect(parser.hasPendingEscape()).toBe(true);
  });

  it("flushPendingEscape はタイムアウト後に単独 ESC を escape キーとして確定する", () => {
    const parser = new PickerKeyParser();
    feed(parser, "\u001B");
    const flushed = parser.flushPendingEscape();
    expect(flushed?.key.escape).toBe(true);
    expect(parser.hasPendingEscape()).toBe(false);
  });

  it("bracketed paste 中の文字は通常の文字として扱われ、コマンド文字 (y/d 等) として解釈されない", () => {
    const parser = new PickerKeyParser();
    const events = feed(parser, "\u001B[200~y d\u001B[201~");
    expect(events.map((keyEvent) => keyEvent.input)).toEqual(["y", " ", "d"]);
    for (const keyEvent of events) {
      expect(keyEvent.key.ctrl).toBe(false);
    }
  });

  it("bracketed paste の終端マーカーがチャンク境界で分割されても検出する", () => {
    const parser = new PickerKeyParser();
    expect(feed(parser, "\u001B[200~ab\u001B[20")).toEqual([
      { input: "a", key: expect.objectContaining({}) },
      { input: "b", key: expect.objectContaining({}) },
    ]);
    const rest = feed(parser, "1~c");
    expect(rest.map((keyEvent) => keyEvent.input)).toEqual(["c"]);
  });

  it("paste 終了後は通常のキー解釈に戻る", () => {
    const parser = new PickerKeyParser();
    feed(parser, "\u001B[200~x\u001B[201~");
    const events = feed(parser, "\u0003");
    expect(events[0]).toEqual({
      input: "c",
      key: expect.objectContaining({ ctrl: true }),
    });
  });
});

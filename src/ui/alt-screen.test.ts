import { describe, expect, it } from "bun:test";
import { type AltScreenTarget, enterAltScreen, leaveAltScreen } from "./alt-screen.ts";

// Matches alt-screen.ts's own construction (char code, not a literal \x1b/ESC byte in source) so this file stays free of non-printable bytes too.
const ASCII_ESCAPE_CODE = 27;
const ESCAPE = String.fromCodePoint(ASCII_ESCAPE_CODE);

const fakeTarget = (
  isTTY: boolean,
): { readonly target: AltScreenTarget; readonly writes: string[] } => {
  const writes: string[] = [];
  return { target: { isTTY, write: (data) => writes.push(data) }, writes };
};

describe("enterAltScreen", () => {
  it("TTY なら alt screen 切替とカーソル非表示のシーケンスを書く", () => {
    const { target, writes } = fakeTarget(true);
    enterAltScreen(target);
    expect(writes).toEqual([`${ESCAPE}[?1049h${ESCAPE}[?25l`]);
  });

  it("TTY でなければ何も書かない (パイプ時に制御コードを吐かない)", () => {
    const { target, writes } = fakeTarget(false);
    enterAltScreen(target);
    expect(writes).toEqual([]);
  });
});

describe("leaveAltScreen", () => {
  it("TTY ならカーソル復元と通常画面への復帰のシーケンスを書く", () => {
    const { target, writes } = fakeTarget(true);
    leaveAltScreen(target);
    expect(writes).toEqual([`${ESCAPE}[?25h${ESCAPE}[?1049l`]);
  });

  it("TTY でなければ何も書かない", () => {
    const { target, writes } = fakeTarget(false);
    leaveAltScreen(target);
    expect(writes).toEqual([]);
  });
});

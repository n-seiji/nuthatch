import { describe, expect, it } from "bun:test";
import {
  type PickerKeyModifiers,
  resolveConfirmKeyAction,
  resolvePanelKeyAction,
  resolvePickerKeyAction,
} from "./picker-keys.ts";

const NO_MODIFIERS: PickerKeyModifiers = {
  ctrl: false,
  meta: false,
  escape: false,
  return: false,
  tab: false,
  upArrow: false,
  downArrow: false,
  leftArrow: false,
  rightArrow: false,
  backspace: false,
  delete: false,
};

const withCtrl = (input: string): [string, PickerKeyModifiers] => [
  input,
  { ...NO_MODIFIERS, ctrl: true },
];

/**
 * The real key shapes a plain (non-kitty) terminal sends for Ctrl+J and
 * Ctrl+H, captured with a pty running ink's own parser (not the synthetic
 * `withCtrl(...)` shape the other tests use) — see picker-keys.ts's module
 * comment. Ctrl+J: input "\n", every flag false. Ctrl+H: key.backspace
 * true, ctrl false, input "" (ink gives it the exact same shape as the
 * Backspace key).
 */
const REAL_CTRL_J: [string, PickerKeyModifiers] = ["\n", NO_MODIFIERS];
const REAL_CTRL_H: [string, PickerKeyModifiers] = ["", { ...NO_MODIFIERS, backspace: true }];

describe("resolvePickerKeyAction", () => {
  it("Escape は cancel (reason: esc)", () => {
    expect(resolvePickerKeyAction("", { ...NO_MODIFIERS, escape: true })).toEqual({
      type: "cancel",
      reason: "esc",
    });
  });

  it("Ctrl+C は cancel (reason: ctrlC)", () => {
    expect(resolvePickerKeyAction(...withCtrl("c"))).toEqual({
      type: "cancel",
      reason: "ctrlC",
    });
  });

  it("Enter は select", () => {
    expect(resolvePickerKeyAction("", { ...NO_MODIFIERS, return: true })).toEqual({
      type: "select",
    });
  });

  it("Tab / → / Ctrl+L / Ctrl+F は action panel を開く (openPanel)", () => {
    expect(resolvePickerKeyAction("", { ...NO_MODIFIERS, tab: true })).toEqual({
      type: "openPanel",
    });
    expect(resolvePickerKeyAction("", { ...NO_MODIFIERS, rightArrow: true })).toEqual({
      type: "openPanel",
    });
    expect(resolvePickerKeyAction(...withCtrl("l"))).toEqual({
      type: "openPanel",
    });
    expect(resolvePickerKeyAction(...withCtrl("f"))).toEqual({
      type: "openPanel",
    });
  });

  it("矢印キーと Ctrl+P/N、Ctrl+K/J は up/down になる (emacs と vim の併存)", () => {
    expect(resolvePickerKeyAction("", { ...NO_MODIFIERS, upArrow: true })).toEqual({
      type: "up",
    });
    expect(resolvePickerKeyAction(...withCtrl("p"))).toEqual({ type: "up" });
    expect(resolvePickerKeyAction(...withCtrl("k"))).toEqual({ type: "up" });
    expect(resolvePickerKeyAction("", { ...NO_MODIFIERS, downArrow: true })).toEqual({
      type: "down",
    });
    expect(resolvePickerKeyAction(...withCtrl("n"))).toEqual({ type: "down" });
    expect(resolvePickerKeyAction(...withCtrl("j"))).toEqual({ type: "down" });
  });

  it("実端末が Ctrl+J に送る生バイト (input が LF、ctrl フラグなし) も down になる (pty 実測、synthetic な withCtrl('j') とは別経路)", () => {
    expect(resolvePickerKeyAction(...REAL_CTRL_J)).toEqual({ type: "down" });
  });

  it("生の LF はクエリへの文字入力 (char) にはならない (down 判定が char 判定より先)", () => {
    expect(resolvePickerKeyAction(...REAL_CTRL_J)).not.toEqual({
      type: "char",
      char: "\n",
    });
  });

  it("Ctrl+U は検索クエリのクリア", () => {
    expect(resolvePickerKeyAction(...withCtrl("u"))).toEqual({ type: "clear" });
  });

  it("Backspace / Delete は backspace", () => {
    expect(resolvePickerKeyAction("", { ...NO_MODIFIERS, backspace: true })).toEqual({
      type: "backspace",
    });
    expect(resolvePickerKeyAction("", { ...NO_MODIFIERS, delete: true })).toEqual({
      type: "backspace",
    });
  });

  it("通常の文字入力は char アクションになる", () => {
    expect(resolvePickerKeyAction("a", NO_MODIFIERS)).toEqual({
      type: "char",
      char: "a",
    });
  });

  it("ctrl/meta 修飾された未知のキーは検索クエリに混入せず ignore になる", () => {
    expect(resolvePickerKeyAction(...withCtrl("z"))).toEqual({
      type: "ignore",
    });
    expect(resolvePickerKeyAction("a", { ...NO_MODIFIERS, meta: true })).toEqual({
      type: "ignore",
    });
  });

  it("Ctrl+X / Ctrl+R はそれぞれ delete / switchRoot のショートカット (Ctrl+K は上移動に再割り当て済みなので panel を開かない)", () => {
    expect(resolvePickerKeyAction(...withCtrl("x"))).toEqual({
      type: "deleteShortcut",
    });
    expect(resolvePickerKeyAction(...withCtrl("r"))).toEqual({
      type: "rootSwitchShortcut",
    });
    expect(resolvePickerKeyAction(...withCtrl("k"))).not.toEqual({
      type: "openPanel",
    });
  });
});

describe("resolvePanelKeyAction", () => {
  it("Escape / Tab / ← / Ctrl+H は close (Tab は開閉のトグル、←/Ctrl+H は開くキーの逆)", () => {
    expect(resolvePanelKeyAction("", { ...NO_MODIFIERS, escape: true })).toEqual({
      type: "close",
    });
    expect(resolvePanelKeyAction("", { ...NO_MODIFIERS, tab: true })).toEqual({
      type: "close",
    });
    expect(resolvePanelKeyAction("", { ...NO_MODIFIERS, leftArrow: true })).toEqual({
      type: "close",
    });
    expect(resolvePanelKeyAction(...withCtrl("h"))).toEqual({
      type: "close",
    });
  });

  it("実端末が Ctrl+H に送る生バイト (key.backspace のみ、ctrl フラグなし) も close になる (物理 Backspace と同じ形なので、panel にテキスト欄が無いことを前提に close に倒す)", () => {
    expect(resolvePanelKeyAction(...REAL_CTRL_H)).toEqual({ type: "close" });
  });

  it("Enter は confirm (ハイライト中のアクションを実行)", () => {
    expect(resolvePanelKeyAction("", { ...NO_MODIFIERS, return: true })).toEqual({
      type: "confirm",
    });
  });

  it("矢印キーと Ctrl+P/N、Ctrl+K/J は up/down になる", () => {
    expect(resolvePanelKeyAction("", { ...NO_MODIFIERS, upArrow: true })).toEqual({
      type: "up",
    });
    expect(resolvePanelKeyAction(...withCtrl("p"))).toEqual({ type: "up" });
    expect(resolvePanelKeyAction(...withCtrl("k"))).toEqual({ type: "up" });
    expect(resolvePanelKeyAction("", { ...NO_MODIFIERS, downArrow: true })).toEqual({
      type: "down",
    });
    expect(resolvePanelKeyAction(...withCtrl("n"))).toEqual({ type: "down" });
    expect(resolvePanelKeyAction(...withCtrl("j"))).toEqual({ type: "down" });
  });

  it("実端末が Ctrl+J に送る生バイトも down になる", () => {
    expect(resolvePanelKeyAction(...REAL_CTRL_J)).toEqual({ type: "down" });
  });

  it("c / d / r は letter ショートカット", () => {
    expect(resolvePanelKeyAction("c", NO_MODIFIERS)).toEqual({
      type: "letter",
      char: "c",
    });
    expect(resolvePanelKeyAction("d", NO_MODIFIERS)).toEqual({
      type: "letter",
      char: "d",
    });
    expect(resolvePanelKeyAction("r", NO_MODIFIERS)).toEqual({
      type: "letter",
      char: "r",
    });
  });

  it("それ以外の文字や ctrl/meta 修飾は ignore", () => {
    expect(resolvePanelKeyAction("z", NO_MODIFIERS)).toEqual({
      type: "ignore",
    });
    expect(resolvePanelKeyAction("c", { ...NO_MODIFIERS, ctrl: true })).toEqual({
      type: "ignore",
    });
  });
});

describe("resolveConfirmKeyAction", () => {
  it("y / Y は yes", () => {
    expect(resolveConfirmKeyAction("y", NO_MODIFIERS)).toEqual({ type: "yes" });
    expect(resolveConfirmKeyAction("Y", NO_MODIFIERS)).toEqual({ type: "yes" });
  });

  it("それ以外 (Escape / n / 何もしない) はすべて no", () => {
    expect(resolveConfirmKeyAction("n", NO_MODIFIERS)).toEqual({ type: "no" });
    expect(resolveConfirmKeyAction("", { ...NO_MODIFIERS, escape: true })).toEqual({
      type: "no",
    });
    expect(resolveConfirmKeyAction(...withCtrl("y"))).toEqual({ type: "no" });
  });
});

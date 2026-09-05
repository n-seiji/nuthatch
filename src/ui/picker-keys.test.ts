import { describe, expect, it } from "bun:test";
import { type PickerKeyModifiers, resolvePickerKeyAction } from "./picker-keys.ts";

const NO_MODIFIERS: PickerKeyModifiers = {
  ctrl: false,
  meta: false,
  escape: false,
  return: false,
  upArrow: false,
  downArrow: false,
  backspace: false,
  delete: false,
};

const withCtrl = (input: string): [string, PickerKeyModifiers] => [
  input,
  { ...NO_MODIFIERS, ctrl: true },
];

describe("resolvePickerKeyAction", () => {
  it("Escape / Ctrl+C は cancel", () => {
    expect(resolvePickerKeyAction("", { ...NO_MODIFIERS, escape: true })).toEqual({
      type: "cancel",
    });
    expect(resolvePickerKeyAction(...withCtrl("c"))).toEqual({
      type: "cancel",
    });
  });

  it("Enter は select", () => {
    expect(resolvePickerKeyAction("", { ...NO_MODIFIERS, return: true })).toEqual({
      type: "select",
    });
  });

  it("矢印キーと Ctrl+P/Ctrl+N は up/down になる", () => {
    expect(resolvePickerKeyAction("", { ...NO_MODIFIERS, upArrow: true })).toEqual({
      type: "up",
    });
    expect(resolvePickerKeyAction(...withCtrl("p"))).toEqual({ type: "up" });
    expect(resolvePickerKeyAction("", { ...NO_MODIFIERS, downArrow: true })).toEqual({
      type: "down",
    });
    expect(resolvePickerKeyAction(...withCtrl("n"))).toEqual({ type: "down" });
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
    expect(resolvePickerKeyAction(...withCtrl("x"))).toEqual({
      type: "ignore",
    });
    expect(resolvePickerKeyAction("a", { ...NO_MODIFIERS, meta: true })).toEqual({
      type: "ignore",
    });
  });
});

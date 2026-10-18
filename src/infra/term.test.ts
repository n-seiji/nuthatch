import { afterEach, describe, expect, it } from "bun:test";
import { colorEnabled } from "./term.ts";

describe("colorEnabled", () => {
  const original = process.env["NO_COLOR"];
  afterEach(() => {
    if (original === undefined) {
      delete process.env["NO_COLOR"];
    } else {
      process.env["NO_COLOR"] = original;
    }
  });

  it("TTY で NO_COLOR が未設定または空の場合、true になる", () => {
    delete process.env["NO_COLOR"];
    expect(colorEnabled({ isTTY: true })).toBe(true);
    process.env["NO_COLOR"] = "";
    expect(colorEnabled({ isTTY: true })).toBe(true);
  });

  it("NO_COLOR が空でない場合、false になる", () => {
    process.env["NO_COLOR"] = "1";
    expect(colorEnabled({ isTTY: true })).toBe(false);
  });

  it("TTY でない場合、false になる", () => {
    delete process.env["NO_COLOR"];
    expect(colorEnabled({ isTTY: false })).toBe(false);
    expect(colorEnabled({})).toBe(false);
  });
});

import { describe, expect, it } from "bun:test";
import { wantsJson } from "./cli-fatal.ts";

describe("wantsJson", () => {
  it("--json が含まれていれば true", () => {
    expect(wantsJson(["ls", "--json"])).toBe(true);
    expect(wantsJson(["--json", "feat/x"])).toBe(true);
  });

  it("--json=true のような値付きの形も認識する", () => {
    expect(wantsJson(["ls", "--json=true"])).toBe(true);
  });

  it("--json が無ければ false (似た名前のフラグには反応しない)", () => {
    expect(wantsJson(["ls"])).toBe(false);
    expect(wantsJson(["ls", "--jsonify"])).toBe(false);
    expect(wantsJson([])).toBe(false);
  });
});

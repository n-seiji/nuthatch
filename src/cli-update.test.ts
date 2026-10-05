import { describe, expect, it } from "bun:test";
import { parseUpdateArgs } from "./cli-update.ts";

describe("parseUpdateArgs", () => {
  it("引数が無い場合、実際の更新 (check: false) で text 出力になる", () => {
    expect(parseUpdateArgs([])).toEqual({
      ok: true,
      check: false,
      json: false,
    });
  });

  it("--check / --json は順不同で認識する", () => {
    expect(parseUpdateArgs(["--check"])).toEqual({
      ok: true,
      check: true,
      json: false,
    });
    expect(parseUpdateArgs(["--json"])).toEqual({
      ok: true,
      check: false,
      json: true,
    });
    expect(parseUpdateArgs(["--json", "--check"])).toEqual({
      ok: true,
      check: true,
      json: true,
    });
  });

  it("未知のフラグの場合、更新に進まず拒否する (--chek の typo で本当に更新してしまわない)", () => {
    const parsed = parseUpdateArgs(["--chek"]);

    expect(parsed.ok).toBe(false);
    expect(parsed).toMatchObject({ json: false });
    expect(parsed.ok ? "" : parsed.message).toContain("--chek");
    expect(parsed.ok ? "" : parsed.message).toContain("hop --update [--check] [--json]");
  });

  it("余計な位置引数や --no-check のような別形式も拒否する", () => {
    for (const token of ["foo", "--no-check", "--check=true", "-c"]) {
      const parsed = parseUpdateArgs(["--check", token]);

      expect(parsed.ok).toBe(false);
      expect(parsed.ok ? "" : parsed.message).toContain(token);
    }
  });

  it("拒否する場合でも --json が付いていれば json: true を保つ (envelope を返すため)", () => {
    expect(parseUpdateArgs(["--json", "--bogus"])).toMatchObject({
      ok: false,
      json: true,
    });
  });
});

import { describe, expect, it } from "bun:test";
import { ROOT_PREVIOUS_TOKEN, rewriteRootPreviousToken } from "./cli-root-command.ts";

describe("rewriteRootPreviousToken", () => {
  it("先頭の単独 '-' をセンチネルに置き換える", () => {
    expect(rewriteRootPreviousToken(["-"])).toEqual([ROOT_PREVIOUS_TOKEN]);
  });

  it("フラグの後ろに '-' があっても置き換える (hop root --json -)", () => {
    expect(rewriteRootPreviousToken(["--json", "-"])).toEqual(["--json", ROOT_PREVIOUS_TOKEN]);
  });

  it("フラグの前に '-' があっても置き換える (hop root - --json)", () => {
    expect(rewriteRootPreviousToken(["-", "--json"])).toEqual([ROOT_PREVIOUS_TOKEN, "--json"]);
  });

  it("値を取るフラグ (--track) の値としての '-' は置き換えない", () => {
    expect(rewriteRootPreviousToken(["--track", "origin/x", "-"])).toEqual([
      "--track",
      "origin/x",
      ROOT_PREVIOUS_TOKEN,
    ]);
  });

  it("--track の値そのものが '-' でも置き換えない", () => {
    expect(rewriteRootPreviousToken(["--track", "-"])).toEqual(["--track", "-"]);
  });

  it("'-' を含まない引数はそのまま返す", () => {
    expect(rewriteRootPreviousToken(["feat", "--json"])).toEqual(["feat", "--json"]);
  });

  it("引数なしはそのまま返す", () => {
    expect(rewriteRootPreviousToken([])).toEqual([]);
  });
});

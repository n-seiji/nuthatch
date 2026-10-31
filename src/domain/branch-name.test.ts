import { describe, expect, it } from "bun:test";
import { isOptionLikeRef, optionLikeRefRejection } from "./branch-name.ts";

describe("isOptionLikeRef", () => {
  it("先頭が - の名前は option-like と判定する", () => {
    expect(isOptionLikeRef("-M")).toBe(true);
    expect(isOptionLikeRef("--force")).toBe(true);
    expect(isOptionLikeRef("-")).toBe(true);
  });

  it("通常の branch 名は option-like ではない", () => {
    expect(isOptionLikeRef("feat/x")).toBe(false);
    expect(isOptionLikeRef("a-b")).toBe(false);
    expect(isOptionLikeRef("")).toBe(false);
  });
});

describe("optionLikeRefRejection", () => {
  it("option-like なら exit 2 の rejection を返す", () => {
    const result = optionLikeRefRejection("branch", "-M");
    expect(result?.ok).toBe(false);
    expect(result?.exitCode).toBe(2);
    expect(result?.errorMessage).toContain("-M");
  });

  it("通常の名前なら null を返す", () => {
    expect(optionLikeRefRejection("branch", "feat/x")).toBeNull();
  });
});

import { describe, expect, it } from "bun:test";
import { parseLastCommit } from "./commit.ts";

describe("parseLastCommit", () => {
  it("sha・日時・件名を読み取る", () => {
    expect(parseLastCommit("abc123\u00002026-10-10T12:00:00+09:00\u0000feat: add x\n")).toEqual({
      sha: "abc123",
      date: "2026-10-10T12:00:00+09:00",
      subject: "feat: add x",
    });
  });

  it("件名が空でも読み取る", () => {
    expect(parseLastCommit("abc123\u00002026-10-10T12:00:00Z\u0000\n")).toEqual({
      sha: "abc123",
      date: "2026-10-10T12:00:00Z",
      subject: "",
    });
  });

  it("出力が空なら null", () => {
    expect(parseLastCommit("")).toBeNull();
  });
});

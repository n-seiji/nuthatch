import { describe, expect, it } from "bun:test";
import { absoluteCandidates, parentDir, shortenHome, splitPathEnv } from "./posix-path.ts";

describe("parentDir", () => {
  it("深いパスの場合、1 つ上のディレクトリを返す", () => {
    expect(parentDir("/home/u/bin/hop")).toBe("/home/u/bin");
    expect(parentDir("a/b/c")).toBe("a/b");
  });

  it("トップレベルのエントリは /、区切りの無い名前は . を返す", () => {
    expect(parentDir("/hop")).toBe("/");
    expect(parentDir("/")).toBe("/");
    expect(parentDir("hop")).toBe(".");
  });

  it("末尾のスラッシュは無視する", () => {
    expect(parentDir("/home/u/bin/")).toBe("/home/u");
  });
});

describe("absoluteCandidates", () => {
  it("絶対パスのエントリだけを順番どおりに name と結合する", () => {
    expect(absoluteCandidates(["/usr/bin", ".", "node_modules/.bin", "/bin/"], "git")).toEqual([
      "/usr/bin/git",
      "/bin/git",
    ]);
  });

  it("前後の空白を除き、重複は最初の 1 つだけ残す", () => {
    expect(absoluteCandidates([" /usr/bin ", "/usr/bin/", "", "/opt/x"], "hop")).toEqual([
      "/usr/bin/hop",
      "/opt/x/hop",
    ]);
  });
});

describe("splitPathEnv", () => {
  it("コロンで区切り、未設定なら空のエントリ 1 つを返す", () => {
    expect(splitPathEnv("/a:/b")).toEqual(["/a", "/b"]);
    expect(splitPathEnv()).toEqual([""]);
  });
});

describe("shortenHome", () => {
  it("$HOME 配下のパスは ~ に置換する", () => {
    expect(shortenHome("/Users/seiji/ghq/repo", "/Users/seiji")).toBe("~/ghq/repo");
  });

  it("$HOME と完全一致する場合は ~ そのもの", () => {
    expect(shortenHome("/Users/seiji", "/Users/seiji")).toBe("~");
  });

  it("$HOME 配下でないパスはそのまま", () => {
    expect(shortenHome("/tmp/repo", "/Users/seiji")).toBe("/tmp/repo");
    expect(shortenHome("/Users/seijix/repo", "/Users/seiji")).toBe("/Users/seijix/repo");
  });

  it("HOME が空または / の場合は何も置換しない", () => {
    expect(shortenHome("/tmp/repo", "")).toBe("/tmp/repo");
    expect(shortenHome("/tmp/repo", "/")).toBe("/tmp/repo");
  });
});

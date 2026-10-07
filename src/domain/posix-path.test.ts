import { describe, expect, it } from "bun:test";
import { baseName, parentDir } from "./posix-path.ts";

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

describe("baseName", () => {
  it("最後の要素を返す (末尾のスラッシュは無視する)", () => {
    expect(baseName("/home/u/installs/node")).toBe("node");
    expect(baseName("/home/u/installs/node/")).toBe("node");
    expect(baseName("node")).toBe("node");
  });

  it("ルートの場合、空文字を返す", () => {
    expect(baseName("/")).toBe("");
  });
});

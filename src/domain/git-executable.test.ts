import { describe, expect, it } from "bun:test";
import {
  GIT_FALLBACK_BIN_DIRS,
  gitExecutableCandidates,
  gitNotFoundMessage,
} from "./git-executable.ts";

const fallbackCandidates = GIT_FALLBACK_BIN_DIRS.map((dir) => `${dir}/git`);

describe("gitExecutableCandidates", () => {
  it("PATH の各ディレクトリを順番どおりに候補化する", () => {
    const candidates = gitExecutableCandidates({ path: "/opt/bin:/usr/local/bin" });

    expect(candidates.slice(0, 2)).toEqual(["/opt/bin/git", "/usr/local/bin/git"]);
  });

  it("PATH で見つからない場合のために既知の設置場所を後ろに足す", () => {
    const candidates = gitExecutableCandidates({ path: "/opt/bin" });

    expect(candidates).toEqual(["/opt/bin/git", ...fallbackCandidates]);
  });

  it("PATH が未設定/空でも既知の設置場所だけで候補を返す", () => {
    expect(gitExecutableCandidates({})).toEqual(fallbackCandidates);
    expect(gitExecutableCandidates({ path: "" })).toEqual(fallbackCandidates);
  });

  it("相対パスの PATH エントリは候補にしない (cwd 依存の実行を防ぐ)", () => {
    const candidates = gitExecutableCandidates({ path: "node_modules/.bin:.:/opt/bin" });

    expect(candidates).toEqual(["/opt/bin/git", ...fallbackCandidates]);
  });

  it("重複するディレクトリは先に出た順で 1 度だけ候補にする", () => {
    const candidates = gitExecutableCandidates({ path: "/usr/bin:/opt/bin:/usr/bin" });

    expect(candidates.filter((candidate) => candidate === "/usr/bin/git")).toHaveLength(1);
    expect(candidates.indexOf("/usr/bin/git")).toBeLessThan(candidates.indexOf("/opt/bin/git"));
  });

  it("末尾スラッシュ付きのエントリでもパスが二重スラッシュにならない", () => {
    expect(gitExecutableCandidates({ path: "/opt/bin/" })[0]).toBe("/opt/bin/git");
    expect(gitExecutableCandidates({ path: "/" })[0]).toBe("/git");
  });

  it("override (HOP_GIT) が指定されたらそれだけを候補にする", () => {
    expect(gitExecutableCandidates({ override: "/custom/bin/git", path: "/opt/bin" })).toEqual([
      "/custom/bin/git",
    ]);
  });

  it("空白だけの override は指定なしとして扱う", () => {
    expect(gitExecutableCandidates({ override: "  ", path: "/opt/bin" })).toEqual([
      "/opt/bin/git",
      ...fallbackCandidates,
    ]);
  });
});

describe("gitNotFoundMessage", () => {
  it("探した場所と次の一手 (HOP_GIT) を含む", () => {
    const message = gitNotFoundMessage(["/opt/bin/git", "/usr/bin/git"]);

    expect(message).toContain("/opt/bin/git");
    expect(message).toContain("/usr/bin/git");
    expect(message).toContain("HOP_GIT");
  });
});

import { describe, expect, it } from "bun:test";
import type { Worktree } from "./model.ts";
import { resolveStatusTarget } from "./status-target.ts";

const worktree = (path: string, branch: string | null, prunable = false): Worktree => ({
  path,
  head: "abc",
  branch,
  detached: branch === null,
  bare: false,
  locked: false,
  lockReason: null,
  prunable,
  prunableReason: null,
  kind: "managed",
});

const root = worktree("/repo", "main");
const nested = worktree("/repo/.claude/worktrees/x", "feat/x");
const managed = worktree("/_worktree/repo/feat__y", "feat/y");

describe("resolveStatusTarget", () => {
  it("branch を持つ worktree を返す", () => {
    expect(resolveStatusTarget([root, managed], { branch: "feat/y" })).toEqual({
      kind: "found",
      worktree: managed,
    });
  });

  it("branch の worktree がなければ notFound", () => {
    expect(resolveStatusTarget([root], { branch: "nope" }).kind).toBe("notFound");
  });

  it("同じ branch が複数の worktree にあれば推測せず ambiguous", () => {
    const twin = worktree("/elsewhere", "feat/y");
    expect(resolveStatusTarget([root, managed, twin], { branch: "feat/y" }).kind).toBe("ambiguous");
  });

  it("cwd を含む worktree のうち一番内側を返す", () => {
    expect(
      resolveStatusTarget([root, nested], { cwdPath: "/repo/.claude/worktrees/x/src" }),
    ).toEqual({ kind: "found", worktree: nested });
    expect(resolveStatusTarget([root, nested], { cwdPath: "/repo/src" })).toEqual({
      kind: "found",
      worktree: root,
    });
  });

  it("prunable な worktree は cwd の照合に使わない", () => {
    const stale = worktree("/repo/.claude/worktrees/x", "feat/x", true);
    expect(resolveStatusTarget([root, stale], { cwdPath: "/repo/.claude/worktrees/x" })).toEqual({
      kind: "found",
      worktree: root,
    });
  });

  it("どの worktree にも含まれない cwd は notFound", () => {
    expect(resolveStatusTarget([root], { cwdPath: "/tmp" }).kind).toBe("notFound");
  });
});

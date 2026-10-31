import { describe, expect, it } from "bun:test";
import type { Worktree } from "./schema.ts";
import { worktreeState } from "./worktree-state.ts";

const worktree = (overrides: Partial<Worktree> = {}): Worktree => ({
  path: "/repo",
  head: "abc",
  branch: "main",
  detached: false,
  bare: false,
  locked: false,
  lockReason: null,
  prunable: false,
  prunableReason: null,
  kind: "root",
  ...overrides,
});

describe("worktreeState", () => {
  it("dirty でない worktree は ✓ clean (green)", () => {
    expect(worktreeState(worktree(), false)).toEqual({
      text: "✓ clean",
      tone: "green",
    });
  });

  it("dirty な worktree は ● changes (yellow)", () => {
    expect(worktreeState(worktree(), true)).toEqual({
      text: "● changes",
      tone: "yellow",
    });
  });

  it("locked は dirty より優先して ⊘ locked (red)", () => {
    expect(worktreeState(worktree({ locked: true }), true)).toEqual({
      text: "⊘ locked",
      tone: "red",
    });
  });

  it("prunable は locked より優先して ✗ missing (red)", () => {
    expect(worktreeState(worktree({ locked: true, prunable: true }), null)).toEqual({
      text: "✗ missing",
      tone: "red",
    });
  });

  it("bare は - bare (dim)", () => {
    expect(worktreeState(worktree({ bare: true }), null)).toEqual({
      text: "- bare",
      tone: "dim",
    });
  });

  it("dirty を調べられなかった (作業ツリーが無い) worktree は ✗ missing", () => {
    expect(worktreeState(worktree(), null)).toEqual({
      text: "✗ missing",
      tone: "red",
    });
  });
});

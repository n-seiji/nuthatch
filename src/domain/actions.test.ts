import { describe, expect, it } from "bun:test";
import { availableActions } from "./actions.ts";
import type { PickCandidate } from "./candidates.ts";
import type { Worktree } from "./model.ts";

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

const worktreeCandidate = (overrides: Partial<Worktree> = {}): PickCandidate => ({
  kind: "worktree",
  worktree: worktree(overrides),
  dirty: null,
});

describe("availableActions", () => {
  it("root worktree は cd のみ (switchRoot も delete も出さない)", () => {
    expect(availableActions(worktreeCandidate({ kind: "root" }))).toEqual(["cd"]);
  });

  it("managed worktree は cd / delete / switchRoot すべて出す", () => {
    expect(availableActions(worktreeCandidate({ kind: "managed", branch: "feat/a" }))).toEqual([
      "cd",
      "delete",
      "switchRoot",
    ]);
  });

  it("external worktree は cd / switchRoot のみ (delete は出さない)", () => {
    expect(availableActions(worktreeCandidate({ kind: "external", branch: "feat/b" }))).toEqual([
      "cd",
      "switchRoot",
    ]);
  });

  it("detached HEAD の worktree は cd のみ (branch が無く rm/root の対象にできない)", () => {
    expect(
      availableActions(worktreeCandidate({ kind: "managed", branch: null, detached: true })),
    ).toEqual(["cd"]);
  });

  it("creatable candidate は cd / switchRoot (delete は worktree が無いので出さない)", () => {
    const candidate: PickCandidate = {
      kind: "creatable",
      branch: "feat/c",
      source: "local",
    };
    expect(availableActions(candidate)).toEqual(["cd", "switchRoot"]);
  });
});

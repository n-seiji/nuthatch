import { describe, expect, it } from "bun:test";
import { buildPickCandidates, candidateBranchLabel, type PickCandidate } from "./candidates.ts";
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

describe("buildPickCandidates", () => {
  it("既存 worktree をすべて候補にし、dirty 情報を反映する", () => {
    const wt = worktree({ path: "/repo", branch: "main" });
    const result = buildPickCandidates([wt], new Map([["/repo", true]]), [], []);
    expect(result).toEqual([{ kind: "worktree", worktree: wt, dirty: true }]);
  });

  it("dirty 情報が無い worktree は dirty: null になる", () => {
    const wt = worktree({ path: "/repo", branch: "main" });
    const result = buildPickCandidates([wt], new Map(), [], []);
    expect(result[0]).toMatchObject({ dirty: null });
  });

  it("worktree の無い local branch は creatable (source: local) として追加する", () => {
    const wt = worktree({ path: "/repo", branch: "main" });
    const result = buildPickCandidates([wt], new Map(), ["main", "feat/a"], []);
    expect(result).toContainEqual({
      kind: "creatable",
      branch: "feat/a",
      source: "local",
    });
    expect(result).not.toContainEqual(
      expect.objectContaining({ kind: "creatable", branch: "main" }),
    );
  });

  it("worktree の無い remote branch は creatable (source: remote) として追加する", () => {
    const result = buildPickCandidates([], new Map(), [], ["feat/remote-only"]);
    expect(result).toEqual([{ kind: "creatable", branch: "feat/remote-only", source: "remote" }]);
  });

  it("local と remote 両方にある branch は local 側のみ 1 回だけ候補にする", () => {
    const result = buildPickCandidates([], new Map(), ["feat/both"], ["feat/both"]);
    expect(result).toEqual([{ kind: "creatable", branch: "feat/both", source: "local" }]);
  });

  it("worktree 済みの branch は creatable candidate から除外する", () => {
    const wt = worktree({ path: "/repo/feat", branch: "feat/x" });
    const result = buildPickCandidates([wt], new Map(), ["feat/x"], ["feat/x"]);
    expect(result).toEqual([{ kind: "worktree", worktree: wt, dirty: null }]);
  });
});

describe("candidateBranchLabel", () => {
  it("worktree candidate は branch 名を返す", () => {
    const candidate: PickCandidate = {
      kind: "worktree",
      worktree: worktree(),
      dirty: null,
    };
    expect(candidateBranchLabel(candidate)).toBe("main");
  });

  it("detached worktree candidate は (detached) を返す", () => {
    const candidate: PickCandidate = {
      kind: "worktree",
      worktree: worktree({ branch: null, detached: true }),
      dirty: null,
    };
    expect(candidateBranchLabel(candidate)).toBe("(detached)");
  });

  it("creatable candidate は branch 名を返す", () => {
    const candidate: PickCandidate = {
      kind: "creatable",
      branch: "feat/x",
      source: "local",
    };
    expect(candidateBranchLabel(candidate)).toBe("feat/x");
  });
});

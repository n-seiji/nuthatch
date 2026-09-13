import { describe, expect, it } from "bun:test";
import type { Worktree } from "../domain/model.ts";
import { otherWorktreePaths } from "./repo.ts";

const worktree = (overrides: Partial<Worktree> = {}): Worktree => ({
  path: "/repo/wt",
  head: "abc",
  branch: "feat/a",
  detached: false,
  bare: false,
  locked: false,
  lockReason: null,
  prunable: false,
  prunableReason: null,
  kind: "managed",
  ...overrides,
});

describe("otherWorktreePaths", () => {
  it("includes a live worktree nested inside the target", () => {
    const target = worktree({ path: "/repo" });
    const nested = worktree({ path: "/repo/.claude/worktrees/x", branch: "x" });

    expect(otherWorktreePaths([target, nested], "/repo")).toEqual(["/repo/.claude/worktrees/x"]);
  });

  it("excludes a prunable registration nested inside the target", () => {
    // A registered worktree whose working directory was removed without
    // `Git worktree prune` (e.g. `rm -rf`): git reports it prunable, and a
    // Real untracked file can later reappear at that same path. Treating it
    // As a live nested worktree would hide that file from a dirty check on
    // The containing worktree — see infra/repo.ts's otherWorktreePaths doc.
    const target = worktree({ path: "/repo" });
    const prunable = worktree({
      path: "/repo/.claude/worktrees/x",
      branch: "x",
      prunable: true,
      prunableReason: "gitdir file points to non-existent location",
    });

    expect(otherWorktreePaths([target, prunable], "/repo")).toEqual([]);
  });

  it("never includes the target's own path or a sibling", () => {
    const target = worktree({ path: "/repo" });
    const sibling = worktree({ path: "/other-repo-wt", branch: "y" });

    expect(otherWorktreePaths([target, sibling], "/repo")).toEqual([]);
  });
});

import { describe, expect, it } from "bun:test";
import type { Worktree } from "../domain/model.ts";
import type { GitPort } from "../domain/ports.ts";
import { nestedWorktreePaths, resolveBranchCheckout, worktreeDirtyState } from "./repo.ts";

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

/** A GitPort that only answers `isDirty`, recording every call it receives. */
const gitWithDirty = (dirty: boolean) => {
  const dirtyChecks: { path: string; nestedPaths: readonly string[] }[] = [];
  const git = {
    isDirty: (path: string, nestedPaths: readonly string[]) => {
      dirtyChecks.push({ path, nestedPaths });
      return Promise.resolve(dirty);
    },
  } as unknown as GitPort;
  return { git, dirtyChecks };
};

/** A GitPort that only answers the branch/remote lookups, recording the remote lookups. */
const gitWithBranches = (localBranches: readonly string[], remotes: readonly string[]) => {
  const remoteLookups: string[] = [];
  const git = {
    listBranches: () => Promise.resolve([...localBranches]),
    remotesWithBranch: (_cwd: string, branch: string) => {
      remoteLookups.push(branch);
      return Promise.resolve([...remotes]);
    },
  } as unknown as GitPort;
  return { git, remoteLookups };
};

const checkout = (git: GitPort, branch: string, explicitTrack?: string) =>
  resolveBranchCheckout(git, "/repo", branch, explicitTrack);

describe("nestedWorktreePaths", () => {
  it("includes a live worktree nested inside the target", () => {
    const target = worktree({ path: "/repo" });
    const nested = worktree({ path: "/repo/.claude/worktrees/x", branch: "x" });

    expect(nestedWorktreePaths([target, nested], "/repo")).toEqual(["/repo/.claude/worktrees/x"]);
  });

  it("excludes a prunable registration nested inside the target", () => {
    // A registered worktree whose working directory was removed without
    // `Git worktree prune` (e.g. `rm -rf`): git reports it prunable, and a
    // Real untracked file can later reappear at that same path. Treating it
    // As a live nested worktree would hide that file from a dirty check on
    // The containing worktree — see infra/repo.ts's nestedWorktreePaths doc.
    const target = worktree({ path: "/repo" });
    const prunable = worktree({
      path: "/repo/.claude/worktrees/x",
      branch: "x",
      prunable: true,
      prunableReason: "gitdir file points to non-existent location",
    });

    expect(nestedWorktreePaths([target, prunable], "/repo")).toEqual([]);
  });

  it("never includes the target's own path or a sibling", () => {
    const target = worktree({ path: "/repo" });
    const sibling = worktree({ path: "/other-repo-wt", branch: "y" });

    expect(nestedWorktreePaths([target, sibling], "/repo")).toEqual([]);
  });
});

describe("worktreeDirtyState", () => {
  it("bare な worktree の場合、git に問い合わせず null になる", async () => {
    const { git, dirtyChecks } = gitWithDirty(true);
    const bare = worktree({ path: "/repo.git", bare: true });

    expect(await worktreeDirtyState(git, [bare], bare)).toBeNull();
    expect(dirtyChecks).toEqual([]);
  });

  it("clean な worktree の場合、ネストした worktree だけを除外対象にして false になる", async () => {
    const { git, dirtyChecks } = gitWithDirty(false);
    const target = worktree({ path: "/repo" });
    const nested = worktree({ path: "/repo/.claude/worktrees/x", branch: "x" });
    const sibling = worktree({ path: "/other-repo-wt", branch: "y" });

    expect(await worktreeDirtyState(git, [target, nested, sibling], target)).toBe(false);
    expect(dirtyChecks).toEqual([{ path: "/repo", nestedPaths: ["/repo/.claude/worktrees/x"] }]);
  });
});

describe("resolveBranchCheckout", () => {
  it("branch が local にある場合、remote を問い合わせず createBranch: false になる", async () => {
    // Two non-origin remotes would make a lookup report "ambiguous".
    const { git, remoteLookups } = gitWithBranches(["feat/a"], ["fork", "upstream"]);

    const result = await checkout(git, "feat/a");

    expect(result).toEqual({ ok: true, options: { createBranch: false } });
    expect(remoteLookups).toEqual([]);
  });

  it("branch が local に無く track を明示した場合、remote を問い合わせずその track で作成する", async () => {
    const { git, remoteLookups } = gitWithBranches([], ["fork", "upstream"]);

    const result = await checkout(git, "feat/a", "upstream/feat/a");

    expect(result).toEqual({
      ok: true,
      options: { createBranch: true, track: "upstream/feat/a" },
    });
    expect(remoteLookups).toEqual([]);
  });

  it("branch が local にあっても track を明示した場合、その track をそのまま渡す", async () => {
    const { git } = gitWithBranches(["feat/a"], []);

    const result = await checkout(git, "feat/a", "origin/feat/a");

    expect(result).toEqual({
      ok: true,
      options: { createBranch: false, track: "origin/feat/a" },
    });
  });

  it("branch が local に無く track も無い場合、その branch 名で remote を問い合わせて track を決める", async () => {
    const { git, remoteLookups } = gitWithBranches([], ["origin"]);

    const result = await checkout(git, "feat/a");

    expect(result).toEqual({
      ok: true,
      options: { createBranch: true, track: "origin/feat/a" },
    });
    expect(remoteLookups).toEqual(["feat/a"]);
  });
});

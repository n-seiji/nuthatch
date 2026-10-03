import { rm as removeDirectory } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createFsPort } from "../infra/fs.ts";
import { createGitPort } from "../infra/git.ts";
import { createTestRepo, type TestRepo } from "../testing/repo.ts";
import { jump } from "./jump.ts";
import { ls } from "./ls.ts";
import { pick } from "./pick.ts";
import { rm } from "./rm.ts";

const git = createGitPort();
const fs = createFsPort();

const BRANCH = "feat/missing";

let repo: TestRepo;
let savedEnv: NodeJS.ProcessEnv;

beforeEach(async () => {
  repo = await createTestRepo();
  savedEnv = { ...process.env };
  Object.assign(process.env, repo.env);
});

afterEach(async () => {
  process.env = savedEnv;
  await repo.cleanup();
});

/** A managed worktree whose directory was deleted without `git worktree prune`. */
const createPrunableWorktree = async (): Promise<string> => {
  const created = await jump(git, fs, {
    cwd: repo.repoPath,
    target: BRANCH,
    create: true,
  });
  if (created.path === undefined) {
    throw new Error("expected jump to report a path");
  }
  await removeDirectory(created.path, { recursive: true, force: true });
  return created.path;
};

describe("ディレクトリが消えた worktree — prunable (integration)", () => {
  it("prunable な worktree がある場合、ls は失敗せず prunable: true かつ dirty: false で返す", async () => {
    const path = await createPrunableWorktree();

    const result = await ls(git, fs, { cwd: repo.repoPath });

    expect(result.ok).toBe(true);
    expect(result.data).toContainEqual(
      expect.objectContaining({ branch: BRANCH, path, prunable: true, dirty: false }),
    );
  });

  it("prunable な worktree がある場合、pick は失敗せず dirty: null の worktree candidate で返す", async () => {
    const path = await createPrunableWorktree();

    const result = await pick(git, fs, { cwd: repo.repoPath });

    expect(result.ok).toBe(true);
    expect(result.data?.candidates).toContainEqual(
      expect.objectContaining({
        kind: "worktree",
        dirty: null,
        worktree: expect.objectContaining({ branch: BRANCH, path, prunable: true }),
      }),
    );
  });

  it("prunable な worktree を rm する場合、dirty 扱いされず登録が削除されて成功する", async () => {
    const path = await createPrunableWorktree();

    const result = await rm(git, fs, {
      cwd: repo.repoPath,
      branch: BRANCH,
      force: false,
      ext: false,
    });

    expect(result.ok).toBe(true);
    const worktrees = await repo.git(["worktree", "list", "--porcelain"]);
    expect(worktrees).not.toContain(path);
  });
});

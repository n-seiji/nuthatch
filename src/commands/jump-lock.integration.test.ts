import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createFsPort } from "../infra/fs.ts";
import { createGitPort } from "../infra/git.ts";
import { acquireRepoLock } from "../infra/lock.ts";
import { createTestRepo, type TestRepo } from "../testing/repo.ts";
import { jump } from "./jump.ts";

const git = createGitPort();
const fs = createFsPort();

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

describe("jump --create — repository lock の競合 (integration)", () => {
  it("repository lock が他の process に保持されている場合、exit 3 の安全拒否になり worktree は作られない", async () => {
    await repo.git(["branch", "feat/lock-contention"]);
    const commonDir = await git.commonDir(repo.repoPath);
    const heldLock = await acquireRepoLock(commonDir);
    try {
      const result = await jump(git, fs, {
        cwd: repo.repoPath,
        target: "feat/lock-contention",
        create: true,
      });

      expect(result.ok).toBe(false);
      expect(result.exitCode).toBe(3);
      expect(result.errorMessage).toContain("locked by another nuthatch process");
    } finally {
      await heldLock.release();
    }

    const worktrees = await repo.git(["worktree", "list", "--porcelain"]);
    expect(worktrees.match(/^worktree /gmu) ?? []).toHaveLength(1);
  });
});

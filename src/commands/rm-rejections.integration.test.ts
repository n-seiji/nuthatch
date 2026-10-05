import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createFsPort } from "../infra/fs.ts";
import { createGitPort } from "../infra/git.ts";
import { createTestRepo, type TestRepo } from "../testing/repo.ts";
import { rm } from "./rm.ts";

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

describe("rm — 失敗・拒否される入力 (integration)", () => {
  it("worktree を持たない branch の場合、exit 1 の失敗になる", async () => {
    await repo.git(["branch", "feat/no-worktree"]);

    const result = await rm(git, fs, {
      cwd: repo.repoPath,
      branch: "feat/no-worktree",
      force: false,
      ext: false,
    });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.errorMessage).toContain("No worktree found for branch");
  });

  it("root clone の branch (main) の場合、exit 2 で root は削除できないと拒否される", async () => {
    const result = await rm(git, fs, {
      cwd: repo.repoPath,
      branch: "main",
      force: false,
      ext: false,
    });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.errorMessage).toBe("Cannot remove the root clone.");
    expect(await fs.exists(repo.repoPath)).toBe(true);
  });

  it("--ext 付きで失敗する場合も、失敗結果に非推奨の警告が 1 件含まれる", async () => {
    await repo.git(["branch", "feat/no-worktree"]);

    const result = await rm(git, fs, {
      cwd: repo.repoPath,
      branch: "feat/no-worktree",
      force: false,
      ext: true,
    });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.errorMessage).toContain("No worktree found for branch");
    expect(result.warnings).toEqual([expect.stringContaining("--ext is deprecated")]);
  });
});

import { access } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createFsPort } from "../infra/fs.ts";
import { createGitPort } from "../infra/git.ts";
import { createTermPort } from "../infra/term.ts";
import { createTestRepo, type TestRepo } from "../testing/repo.ts";
import { clean } from "./clean.ts";
import { jump } from "./jump.ts";

const git = createGitPort();
const fs = createFsPort();
const term = createTermPort();

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

describe("削除できなかった候補の報告", () => {
  const createMergedWorktree = async (branch: string): Promise<string> => {
    await repo.git(["checkout", "-b", branch]);
    await repo.git(["checkout", "main"]);
    await repo.git(["merge", branch]);
    const created = await jump(git, fs, { cwd: repo.repoPath, target: branch, create: true });
    if (created.path === undefined) {
      throw new Error("expected jump to report a path");
    }
    return created.path;
  };

  it("git が locked と報告する worktree は候補から外し、理由を warning で返す", async () => {
    const lockedPath = await createMergedWorktree("feat/locked");
    await repo.git(["worktree", "lock", "--reason", "in use by agent", lockedPath]);

    const result = await clean(git, fs, term, {
      cwd: repo.repoPath,
      ext: false,
      withBranch: false,
      dryRun: false,
      yes: true,
    });

    expect(result.ok).toBe(true);
    expect(result.data?.candidates).toEqual([]);
    expect(result.data?.removed).toEqual([]);
    expect(result.warnings).toEqual([
      expect.stringContaining(`Skipped ${lockedPath}: locked by git (in use by agent)`),
    ]);
    await access(lockedPath);
  });

  it("git worktree remove が失敗した候補は git の理由付きで warning にし、残りは削除を続ける", async () => {
    const failingPath = await createMergedWorktree("feat/fails");
    const okPath = await createMergedWorktree("feat/ok");
    const failingGit = {
      ...git,
      removeWorktree: async (cwd: string, path: string, force: boolean) => {
        if (path === failingPath) {
          throw Object.assign(new Error("Command failed: git worktree remove"), {
            code: 128,
            stderr: "fatal: working trees containing submodules cannot be moved or removed\n",
          });
        }
        await git.removeWorktree(cwd, path, force);
      },
    };

    const result = await clean(failingGit, fs, term, {
      cwd: repo.repoPath,
      ext: false,
      withBranch: false,
      dryRun: false,
      yes: true,
    });

    expect(result.ok).toBe(true);
    expect(result.data?.removed).toEqual(["feat/ok"]);
    expect(result.warnings).toEqual([
      `Failed to remove ${failingPath}: fatal: working trees containing submodules cannot be moved or removed`,
    ]);
    await access(failingPath);
    await expect(access(okPath)).rejects.toThrow();
  });

  it("root が rebase 途中 (detached HEAD) でも merge 済み worktree を削除する", async () => {
    const mergedPath = await createMergedWorktree("feat/merged-during-rebase");
    await repo.writeFile("r1.txt", "r1");
    await repo.git(["add", "r1.txt"]);
    await repo.git(["commit", "-m", "r1"]);
    await repo.writeFile("r2.txt", "r2");
    await repo.git(["add", "r2.txt"]);
    await repo.git(["commit", "-m", "r2"]);
    await repo.git(["-c", "sequence.editor=sed -i.bak 1abreak", "rebase", "-i", "HEAD~2"]);
    expect(await repo.git(["status"])).toContain("rebase in progress");

    const result = await clean(git, fs, term, {
      cwd: repo.repoPath,
      ext: false,
      withBranch: false,
      dryRun: false,
      yes: true,
    });

    expect(result.data?.removed).toEqual(["feat/merged-during-rebase"]);
    expect(result.warnings).toBeUndefined();
    await expect(access(mergedPath)).rejects.toThrow();
  });
});

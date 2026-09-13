import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createFsPort } from "../infra/fs.ts";
import { createGitPort } from "../infra/git.ts";
import { createTestRepo, type TestRepo } from "../testing/repo.ts";
import { rm } from "./rm.ts";

const git = createGitPort();
const fs = createFsPort();

let repo: TestRepo;

beforeEach(async () => {
  repo = await createTestRepo();
});

afterEach(async () => {
  await repo.cleanup();
});

describe("rm — duplicate branch holders", () => {
  it("同じ branch を複数 worktree が保持している場合は対象を推測せず拒否する", async () => {
    await repo.git(["branch", "feat/duplicate"]);
    const firstPath = `${repo.rootDir}/agent-worktrees/duplicate-1`;
    const secondPath = `${repo.rootDir}/agent-worktrees/duplicate-2`;
    await repo.git(["worktree", "add", firstPath, "feat/duplicate"]);
    await repo.git(["worktree", "add", "--force", secondPath, "feat/duplicate"]);

    const result = await rm(git, fs, {
      cwd: repo.repoPath,
      branch: "feat/duplicate",
      force: false,
      ext: false,
    });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);
    expect(result.errorMessage).toContain("2 worktrees");
    const after = await repo.git(["worktree", "list", "--porcelain"]);
    expect(after).toContain(firstPath);
    expect(after).toContain(secondPath);
  });

  it("picker が path を指定した場合は同じ branch の別 worktree を削除しない", async () => {
    await repo.git(["branch", "feat/picker-duplicate"]);
    const firstPath = `${repo.rootDir}/agent-worktrees/picker-duplicate-1`;
    const selectedPath = `${repo.rootDir}/agent-worktrees/picker-duplicate-2`;
    await repo.git(["worktree", "add", firstPath, "feat/picker-duplicate"]);
    await repo.git(["worktree", "add", "--force", selectedPath, "feat/picker-duplicate"]);
    const selectedRealPath = await fs.realpath(selectedPath);

    const result = await rm(git, fs, {
      cwd: repo.repoPath,
      branch: "feat/picker-duplicate",
      expectedPath: selectedRealPath,
      force: false,
      ext: false,
    });

    expect(result.ok).toBe(true);
    expect(result.data?.path).toBe(selectedRealPath);
    const after = await repo.git(["worktree", "list", "--porcelain"]);
    expect(after).toContain(firstPath);
    expect(after).not.toContain(selectedPath);
  });
});

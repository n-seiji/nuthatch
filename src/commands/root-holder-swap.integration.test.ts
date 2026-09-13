import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createFsPort } from "../infra/fs.ts";
import { createGitPort } from "../infra/git.ts";
import { createTestRepo, type TestRepo } from "../testing/repo.ts";
import { root } from "./root.ts";

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

describe("root — holder-swap edge cases (integration)", () => {
  it("holder が2つある branch は detach せず swap を拒否する (`git worktree add --force` で作られた複製)", async () => {
    // Regression: previously `find` picked the first holder, detached it,
    // Then root's own switchBranch failed because the *other* holder still
    // Had the branch checked out — leaving the first holder stranded in
    // Detached HEAD even after rollback tried to restore it. Must be
    // Refused up front, before detaching anything.
    await repo.git(["branch", "dup"]);
    const h1Path = `${repo.rootDir}/agent-worktrees/dup-1`;
    const h2Path = `${repo.rootDir}/agent-worktrees/dup-2`;
    await repo.git(["worktree", "add", h1Path, "dup"]);
    await repo.git(["worktree", "add", "--force", h2Path, "dup"]);

    const result = await root(git, fs, {
      cwd: repo.repoPath,
      target: "dup",
    });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);
    expect(result.errorMessage).toContain(h1Path);
    expect(result.errorMessage).toContain(h2Path);

    const rootBranchOutput = await repo.git(["branch", "--show-current"]);
    expect(rootBranchOutput.trim()).toBe("main");
    const h1BranchOutput = await repo.git(["branch", "--show-current"], h1Path);
    expect(h1BranchOutput.trim()).toBe("dup");
    const h2BranchOutput = await repo.git(["branch", "--show-current"], h2Path);
    expect(h2BranchOutput.trim()).toBe("dup");
  });

  it("unborn HEAD の holder (git worktree add --orphan) は正しい理由で swap を拒否する", async () => {
    // Regression: an unborn-HEAD branch (created via `git worktree add
    // --Orphan`, no commits yet) never appears in `git for-each-ref
    // Refs/heads/`, so hop's own branchExistsLocally check comes back
    // False and it treats this as createBranch=true — the rejection
    // Message must describe *that* (not claim the branch "was just
    // Created elsewhere", which isn't true here).
    const orphanPath = `${repo.rootDir}/agent-worktrees/orphan`;
    await repo.git(["worktree", "add", "--orphan", "-b", "orphanbranch", orphanPath]);

    const result = await root(git, fs, {
      cwd: repo.repoPath,
      target: "orphanbranch",
    });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);
    expect(result.errorMessage).toContain(orphanPath);
    expect(result.errorMessage).not.toContain("was just created elsewhere");
    expect(result.errorMessage).toContain(
      "wasn't visible when hop checked existing local branches",
    );
  });
});

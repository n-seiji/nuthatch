import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
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

const createUnmergedTrackedWorktree = async (
  branch: string,
  originDir: string,
): Promise<string> => {
  await repo.git(["init", "--bare", originDir]);
  await repo.git(["remote", "add", "origin", originDir]);
  await repo.git(["checkout", "-b", branch]);
  await repo.writeFile(`${branch.replaceAll("/", "-")}.txt`, "unmerged");
  await repo.git(["add", "."]);
  await repo.git(["commit", "-m", "unmerged change"]);
  await repo.git(["checkout", "main"]);
  await repo.git(["push", "origin", "main"]);
  await repo.git(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
  await repo.git(["push", "-u", "origin", branch]);

  const created = await jump(git, fs, {
    cwd: repo.repoPath,
    target: branch,
    create: true,
  });
  if (created.path === undefined) {
    throw new Error("expected jump to report a path");
  }
  return created.path;
};

beforeEach(async () => {
  repo = await createTestRepo();
  savedEnv = { ...process.env };
  Object.assign(process.env, repo.env);
});

afterEach(async () => {
  process.env = savedEnv;
  await repo.cleanup();
});

describe("clean --with-branch on prunable worktrees (integration)", () => {
  it("prunable かつ未マージの branch は --with-branch でも残し、理由を返す", async () => {
    const originDir = await mkdtemp(`${tmpdir()}/nuthatch-origin-`);
    try {
      const worktreePath = await createUnmergedTrackedWorktree("feat/prunable-unmerged", originDir);
      await rm(worktreePath, { recursive: true, force: true });

      const result = await clean(git, fs, term, {
        cwd: repo.repoPath,
        ext: false,
        withBranch: true,
        dryRun: false,
        yes: true,
      });

      expect(result.ok).toBe(true);
      expect(result.data?.removed).toEqual(["feat/prunable-unmerged"]);
      expect(result.warnings?.some((warning) => warning.includes("feat/prunable-unmerged"))).toBe(
        true,
      );
      const branches = await repo.git(["branch", "--list", "feat/prunable-unmerged"]);
      expect(branches.trim()).toContain("feat/prunable-unmerged");
      const worktrees = await repo.git(["worktree", "list", "--porcelain"]);
      expect(worktrees).not.toContain(worktreePath);
    } finally {
      await rm(originDir, { recursive: true, force: true });
    }
  });

  it("prunable かつ default branch に merge 済みの branch は --with-branch で削除する", async () => {
    const originDir = await mkdtemp(`${tmpdir()}/nuthatch-origin-`);
    try {
      const worktreePath = await createUnmergedTrackedWorktree("feat/prunable-merged", originDir);
      await repo.git(["merge", "feat/prunable-merged"]);
      await repo.git(["push", "origin", "main"]);
      await rm(worktreePath, { recursive: true, force: true });

      const result = await clean(git, fs, term, {
        cwd: repo.repoPath,
        ext: false,
        withBranch: true,
        dryRun: false,
        yes: true,
      });

      expect(result.ok).toBe(true);
      expect(result.data?.removed).toEqual(["feat/prunable-merged"]);
      expect(result.warnings?.some((warning) => warning.includes("Keeping branch"))).toBeFalsy();
      const branches = await repo.git(["branch", "--list", "feat/prunable-merged"]);
      expect(branches.trim()).toBe("");
      const worktrees = await repo.git(["worktree", "list", "--porcelain"]);
      expect(worktrees).not.toContain(worktreePath);
    } finally {
      await rm(originDir, { recursive: true, force: true });
    }
  });

  it("prunable で upstream が gone かつ squash merge 済みの branch は --with-branch で削除する", async () => {
    const originDir = await mkdtemp(`${tmpdir()}/nuthatch-origin-`);
    try {
      await repo.git(["init", "--bare", originDir]);
      await repo.git(["remote", "add", "origin", originDir]);
      await repo.git(["push", "origin", "main"]);
      await repo.git(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);

      await repo.git(["branch", "feat/prunable-gone"]);
      const created = await jump(git, fs, {
        cwd: repo.repoPath,
        target: "feat/prunable-gone",
        create: true,
      });
      const worktreePath = created.path;
      if (worktreePath === undefined) {
        throw new Error("expected jump to report a path");
      }
      await Bun.write(`${worktreePath}/squash.txt`, "content");
      await repo.git(["add", "squash.txt"], worktreePath);
      await repo.git(["commit", "-m", "add squash.txt"], worktreePath);
      const commitShaOutput = await repo.git(["rev-parse", "HEAD"], worktreePath);
      const commitSha = commitShaOutput.trim();

      // Cherry-pick -x gives main an equivalent change under a different hash,
      // So the branch is never a literal ancestor, as after a squash merge.
      await repo.git(["cherry-pick", "-x", commitSha]);
      await repo.git(["push", "origin", "main"]);
      await repo.git(["push", "-u", "origin", "feat/prunable-gone"]);
      await repo.git(["push", "origin", "--delete", "feat/prunable-gone"]);
      await repo.git(["fetch", "--prune", "origin"]);
      await rm(worktreePath, { recursive: true, force: true });

      const result = await clean(git, fs, term, {
        cwd: repo.repoPath,
        ext: false,
        withBranch: true,
        dryRun: false,
        yes: true,
      });

      expect(result.ok).toBe(true);
      expect(result.data?.removed).toEqual(["feat/prunable-gone"]);
      expect(result.warnings?.some((warning) => warning.includes("Keeping branch"))).toBeFalsy();
      const branches = await repo.git(["branch", "--list", "feat/prunable-gone"]);
      expect(branches.trim()).toBe("");
      const worktrees = await repo.git(["worktree", "list", "--porcelain"]);
      expect(worktrees).not.toContain(worktreePath);
    } finally {
      await rm(originDir, { recursive: true, force: true });
    }
  });

  it("prunable で upstream が gone でも default branch に未反映の branch は --with-branch でも残し、理由を返す", async () => {
    const originDir = await mkdtemp(`${tmpdir()}/nuthatch-origin-`);
    try {
      await repo.git(["init", "--bare", originDir]);
      await repo.git(["remote", "add", "origin", originDir]);
      await repo.git(["push", "origin", "main"]);
      await repo.git(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);

      await repo.git(["branch", "feat/prunable-gone-unmerged"]);
      const created = await jump(git, fs, {
        cwd: repo.repoPath,
        target: "feat/prunable-gone-unmerged",
        create: true,
      });
      const worktreePath = created.path;
      if (worktreePath === undefined) {
        throw new Error("expected jump to report a path");
      }
      await Bun.write(`${worktreePath}/unmerged.txt`, "content");
      await repo.git(["add", "unmerged.txt"], worktreePath);
      await repo.git(["commit", "-m", "add unmerged.txt"], worktreePath);

      // The upstream is deleted without the change ever reaching main.
      await repo.git(["push", "-u", "origin", "feat/prunable-gone-unmerged"]);
      await repo.git(["push", "origin", "--delete", "feat/prunable-gone-unmerged"]);
      await repo.git(["fetch", "--prune", "origin"]);
      await rm(worktreePath, { recursive: true, force: true });

      const result = await clean(git, fs, term, {
        cwd: repo.repoPath,
        ext: false,
        withBranch: true,
        dryRun: false,
        yes: true,
      });

      expect(result.ok).toBe(true);
      expect(result.data?.removed).toEqual(["feat/prunable-gone-unmerged"]);
      expect(
        result.warnings?.some((warning) =>
          warning.includes('Keeping branch "feat/prunable-gone-unmerged"'),
        ),
      ).toBe(true);
      const branches = await repo.git(["branch", "--list", "feat/prunable-gone-unmerged"]);
      expect(branches.trim()).toContain("feat/prunable-gone-unmerged");
      const worktrees = await repo.git(["worktree", "list", "--porcelain"]);
      expect(worktrees).not.toContain(worktreePath);
    } finally {
      await rm(originDir, { recursive: true, force: true });
    }
  });

  it("prunable で default branch が解決できない場合は merge 済みでも --with-branch で branch を残し、理由を返す", async () => {
    // No origin remote and no local main/master, so resolveDefaultBranchRef yields null.
    await repo.git(["branch", "-m", "main", "trunk"]);
    await repo.git(["branch", "feat/prunable-no-default"]);
    const created = await jump(git, fs, {
      cwd: repo.repoPath,
      target: "feat/prunable-no-default",
      create: true,
    });
    const worktreePath = created.path;
    if (worktreePath === undefined) {
      throw new Error("expected jump to report a path");
    }
    await rm(worktreePath, { recursive: true, force: true });

    const result = await clean(git, fs, term, {
      cwd: repo.repoPath,
      ext: false,
      withBranch: true,
      dryRun: false,
      yes: true,
    });

    expect(result.ok).toBe(true);
    expect(result.data?.removed).toEqual(["feat/prunable-no-default"]);
    expect(
      result.warnings?.some((warning) =>
        warning.includes('Keeping branch "feat/prunable-no-default"'),
      ),
    ).toBe(true);
    const branches = await repo.git(["branch", "--list", "feat/prunable-no-default"]);
    expect(branches.trim()).toContain("feat/prunable-no-default");
    const worktrees = await repo.git(["worktree", "list", "--porcelain"]);
    expect(worktrees).not.toContain(worktreePath);
  });
});

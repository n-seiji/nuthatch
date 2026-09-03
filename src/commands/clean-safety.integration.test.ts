import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  const created = await jump(git, fs, term, {
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

describe("clean safety (integration)", () => {
  it("clean でも未マージかつ upstream 生存の branch は候補にしない", async () => {
    const originDir = await mkdtemp(join(tmpdir(), "nuthatch-origin-"));
    try {
      await createUnmergedTrackedWorktree("feat/unmerged-alive", originDir);

      const result = await clean(git, fs, term, {
        cwd: repo.repoPath,
        ext: false,
        withBranch: false,
        dryRun: true,
        yes: false,
      });

      expect(result.data?.candidates).toEqual([]);
    } finally {
      await rm(originDir, { recursive: true, force: true });
    }
  });

  it("prunable かつ未マージの branch は --with-branch でも残し、理由を返す", async () => {
    const originDir = await mkdtemp(join(tmpdir(), "nuthatch-origin-"));
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
});

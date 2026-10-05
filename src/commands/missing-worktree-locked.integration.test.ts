import { rm as removeDirectory } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createFsPort } from "../infra/fs.ts";
import { createGitPort } from "../infra/git.ts";
import { createTermPort } from "../infra/term.ts";
import { createTestRepo, type TestRepo } from "../testing/repo.ts";
import { clean } from "./clean.ts";
import { jump } from "./jump.ts";
import { ls } from "./ls.ts";
import { rm } from "./rm.ts";

const git = createGitPort();
const fs = createFsPort();
const term = createTermPort();

const BRANCH = "feat/missing-locked";

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

/**
 * A managed worktree that git has locked (e.g. it lives on a volume that may
 * be unmounted) and whose directory is then gone. git never marks a locked
 * worktree prunable, so it stays registered as an ordinary entry.
 */
const createLockedMissingWorktree = async (): Promise<string> => {
  const created = await jump(git, fs, {
    cwd: repo.repoPath,
    target: BRANCH,
    create: true,
  });
  if (created.path === undefined) {
    throw new Error("expected jump to report a path");
  }
  await repo.git(["worktree", "lock", created.path, "--reason", "unmounted volume"]);
  await removeDirectory(created.path, { recursive: true, force: true });
  return created.path;
};

describe("ディレクトリが消えた worktree — git ロック中 (integration)", () => {
  it("git ロック中でディレクトリが消えた worktree がある場合、ls は失敗せず locked: true かつ dirty: false で返す", async () => {
    const path = await createLockedMissingWorktree();

    const result = await ls(git, fs, { cwd: repo.repoPath });

    expect(result.ok).toBe(true);
    expect(result.data).toContainEqual(
      expect.objectContaining({ branch: BRANCH, path, locked: true, dirty: false }),
    );
  });

  it("git ロック中でディレクトリが消えた worktree を rm する場合、exit 3 で拒否され登録は残る", async () => {
    const path = await createLockedMissingWorktree();

    const result = await rm(git, fs, {
      cwd: repo.repoPath,
      branch: BRANCH,
      force: false,
      ext: false,
    });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);
    expect(result.errorMessage).toContain("is locked by git");
    const worktrees = await repo.git(["worktree", "list", "--porcelain"]);
    expect(worktrees).toContain(path);
  });

  it("git ロック中でディレクトリが消えた worktree がある場合、clean は失敗せず候補にしない", async () => {
    await createLockedMissingWorktree();

    const result = await clean(git, fs, term, {
      cwd: repo.repoPath,
      ext: false,
      withBranch: false,
      dryRun: true,
      yes: false,
    });

    expect(result.ok).toBe(true);
    expect(result.data?.candidates).toEqual([]);
  });
});

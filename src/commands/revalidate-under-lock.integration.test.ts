import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createFsPort } from "../infra/fs.ts";
import { createGitPort } from "../infra/git.ts";
import { acquireRepoLock } from "../infra/lock.ts";
import { createTermPort } from "../infra/term.ts";
import { createTestRepo, type TestRepo } from "../testing/repo.ts";
import { clean } from "./clean.ts";
import { jump } from "./jump.ts";
import { rm } from "./rm.ts";
import { root } from "./root.ts";

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

/**
 * Probes for the repo lock through the lock directory alone. It must not spawn
 * git: a second `rev-parse` racing hop's own `commonDir` intermittently left
 * that call unresolved under bun, which hung the test.
 */
const isRepoLockHeld = async (): Promise<boolean> => {
  try {
    const lock = await acquireRepoLock(`${repo.repoPath}/.git`);
    await lock.release();
    return false;
  } catch (error) {
    return error instanceof Error && error.message.includes("locked by another nuthatch process");
  }
};

/**
 * A real GitPort whose second worktree listing first runs `hook`. Every
 * mutation lists once before taking the repo lock and once under it, so the
 * hook lands in the window that the re-validation under the lock exists for
 * (asserted: with the lock not held, the hook would pin nothing). Use it for
 * the command under test only: setup through it would burn the calls.
 */
const gitChangingOnSecondListing = (hook: () => Promise<void>): typeof git => {
  let calls = 0;
  return {
    ...git,
    listWorktreesPorcelain: async (cwd) => {
      calls += 1;
      if (calls === 2) {
        expect(await isRepoLockHeld()).toBe(true);
        await hook();
      }
      return git.listWorktreesPorcelain(cwd);
    },
  };
};

const createManagedWorktree = async (branch: string): Promise<string> => {
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

/** Ignoring `.claude/` means git alone would not refuse to remove a worktree holding one. */
const ignoreNestedWorktreeDir = (): Promise<number> =>
  Bun.write(`${repo.repoPath}/.git/info/exclude`, ".claude/\n");

describe("lock 取得後の再検証 (integration)", () => {
  it("rm: lock 待ちの間に対象の中へ worktree が登録された場合、削除を拒否して中身を壊さない", async () => {
    const outerPath = await createManagedWorktree("feat/outer");
    await ignoreNestedWorktreeDir();
    const innerPath = `${outerPath}/.claude/worktrees/inner`;
    const racingGit = gitChangingOnSecondListing(async () => {
      await repo.git(["worktree", "add", innerPath, "-b", "feat/inner"]);
    });

    const result = await rm(racingGit, fs, {
      cwd: repo.repoPath,
      branch: "feat/outer",
      force: false,
      ext: false,
    });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);
    expect(result.errorMessage).toContain("still contains");
    expect(await fs.exists(outerPath)).toBe(true);
    expect(await fs.exists(innerPath)).toBe(true);
    const worktrees = await repo.git(["worktree", "list", "--porcelain"]);
    expect(worktrees).toContain(innerPath);
  });

  it("rm: lock 待ちの間に対象の branch が root clone へ移った場合、root は削除できないと拒否する", async () => {
    const outerPath = await createManagedWorktree("feat/moved");
    const racingGit = gitChangingOnSecondListing(async () => {
      await repo.git(["switch", "--detach"], outerPath);
      await repo.git(["switch", "feat/moved"]);
    });

    const result = await rm(racingGit, fs, {
      cwd: repo.repoPath,
      branch: "feat/moved",
      force: false,
      ext: false,
    });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.errorMessage).toBe("Cannot remove the root clone.");
    expect(await fs.exists(repo.repoPath)).toBe(true);
    expect(await fs.exists(outerPath)).toBe(true);
    const worktrees = await repo.git(["worktree", "list", "--porcelain"]);
    expect(worktrees).toContain(outerPath);
  });

  it("clean: lock 待ちの間に候補の中へ worktree が登録された場合、その候補は警告つきで skip する", async () => {
    const outerPath = await createManagedWorktree("feat/outer");
    await ignoreNestedWorktreeDir();
    const innerPath = `${outerPath}/.claude/worktrees/inner`;
    const racingGit = gitChangingOnSecondListing(async () => {
      await repo.git(["worktree", "add", innerPath, "-b", "feat/inner"]);
      await Bun.write(`${innerPath}/inner.txt`, "work in progress");
    });

    const result = await clean(racingGit, fs, term, {
      cwd: repo.repoPath,
      ext: false,
      withBranch: false,
      dryRun: false,
      yes: true,
    });

    expect(result.ok).toBe(true);
    expect(result.data?.removed).toEqual([]);
    expect(result.warnings).toContain(
      `Skipped ${outerPath}: still contains a registered worktree.`,
    );
    expect(await fs.exists(outerPath)).toBe(true);
    expect(await fs.exists(`${innerPath}/inner.txt`)).toBe(true);
    const worktrees = await repo.git(["worktree", "list", "--porcelain"]);
    expect(worktrees).toContain(outerPath);
    expect(worktrees).toContain(innerPath);
  });

  it("root: lock 待ちの間に root clone が dirty になった場合、切替を拒否して branch を変えない", async () => {
    await repo.git(["branch", "feat/target"]);
    const racingGit = gitChangingOnSecondListing(() => repo.writeFile("dirty.txt", "uncommitted"));

    const result = await root(racingGit, fs, {
      cwd: repo.repoPath,
      target: "feat/target",
    });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);
    expect(result.errorMessage).toContain("Root clone has uncommitted or untracked changes");
    const rootBranch = await repo.git(["branch", "--show-current"]);
    expect(rootBranch.trim()).toBe("main");
  });

  it("jump --create: lock 待ちの間に別 process が同じ branch の worktree を作った場合、それを返し created: false になる", async () => {
    await repo.git(["branch", "feat/raced"]);
    const racedPath = `${repo.rootDir}/agent-worktrees/raced`;
    const racingGit = gitChangingOnSecondListing(async () => {
      await repo.git(["worktree", "add", racedPath, "feat/raced"]);
    });

    const result = await jump(racingGit, fs, {
      cwd: repo.repoPath,
      target: "feat/raced",
      create: true,
    });

    expect(result.ok).toBe(true);
    expect(result.data?.created).toBe(false);
    expect(result.path).toBe(await fs.realpath(racedPath));
    const worktrees = await repo.git(["worktree", "list", "--porcelain"]);
    expect(worktrees.match(/^worktree /gmu) ?? []).toHaveLength(2);
  });
});

import { rm as removeDirectory } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createFsPort } from "../infra/fs.ts";
import { createGitPort } from "../infra/git.ts";
import { createTestRepo, type TestRepo } from "../testing/repo.ts";
import { jump } from "./jump.ts";
import { ls } from "./ls.ts";
import { pick } from "./pick.ts";
import { rm } from "./rm.ts";
import { root } from "./root.ts";

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

const createManagedWorktree = async (): Promise<string> => {
  const created = await jump(git, fs, {
    cwd: repo.repoPath,
    target: BRANCH,
    create: true,
  });
  if (created.path === undefined) {
    throw new Error("expected jump to report a path");
  }
  return created.path;
};

/** A managed worktree whose directory was deleted without `git worktree prune`. */
const createPrunableWorktree = async (): Promise<string> => {
  const path = await createManagedWorktree();
  await removeDirectory(path, { recursive: true, force: true });
  return path;
};

/** The reason git gives for `path` being prunable (its wording varies between git versions). */
const prunableReasonOf = async (path: string): Promise<string> => {
  const listed = await ls(git, fs, { cwd: repo.repoPath });
  const reason = listed.data?.find((entry) => entry.path === path)?.prunableReason;
  if (reason === undefined || reason === null) {
    throw new Error("expected git to report a prunable reason");
  }
  return reason;
};

describe("ディレクトリが消えた worktree — prunable (integration)", () => {
  it("prunable な worktree がある場合、ls は失敗せず prunable: true かつ dirty: false で返す", async () => {
    const path = await createPrunableWorktree();

    const result = await ls(git, fs, { cwd: repo.repoPath });

    expect(result.ok).toBe(true);
    expect(result.data).toContainEqual(
      expect.objectContaining({
        branch: BRANCH,
        path,
        prunable: true,
        dirty: false,
      }),
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
        worktree: expect.objectContaining({
          branch: BRANCH,
          path,
          prunable: true,
        }),
      }),
    );
  });

  it("prunable な worktree を rm する場合、dirty 扱いされず登録だけが削除され、その旨を警告して成功する", async () => {
    const path = await createPrunableWorktree();
    const reason = await prunableReasonOf(path);

    const result = await rm(git, fs, {
      cwd: repo.repoPath,
      branch: BRANCH,
      force: false,
      ext: false,
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([
      `Worktree at ${path} no longer exists (${reason}); only its stale registration was removed.`,
    ]);
    const worktrees = await repo.git(["worktree", "list", "--porcelain"]);
    expect(worktrees).not.toContain(path);
  });

  it("git が prunable の理由を報告しない場合、rm の警告から理由の括弧を省く", async () => {
    const path = await createPrunableWorktree();
    const gitWithoutReason: typeof git = {
      ...git,
      listWorktreesPorcelain: async (cwd) => {
        const output = await git.listWorktreesPorcelain(cwd);
        return output
          .split("\0")
          .map((line) => (line.startsWith("prunable ") ? "prunable" : line))
          .join("\0");
      },
    };

    const result = await rm(gitWithoutReason, fs, {
      cwd: repo.repoPath,
      branch: BRANCH,
      force: false,
      ext: false,
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([
      `Worktree at ${path} no longer exists; only its stale registration was removed.`,
    ]);
  });

  it("prunable な worktree を --ext 付きで rm する場合、非推奨の警告は登録削除の警告の後ろに付く", async () => {
    await createPrunableWorktree();

    const result = await rm(git, fs, {
      cwd: repo.repoPath,
      branch: BRANCH,
      force: false,
      ext: true,
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([
      expect.stringContaining("only its stale registration was removed"),
      expect.stringContaining("--ext is deprecated"),
    ]);
  });

  it("prunable な worktree が branch を保持している場合、root は swap を拒否して理由と対処を示す", async () => {
    const path = await createPrunableWorktree();

    const result = await root(git, fs, { cwd: repo.repoPath, target: BRANCH });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);
    expect(result.errorMessage).toContain("stale worktree registration");
    expect(result.errorMessage).toContain(path);
    expect(result.errorMessage).toContain(`hop rm ${BRANCH}`);
    // The holder's missing directory must never reach a git spawn.
    expect(result.errorMessage).not.toContain("Failed to switch root");
    const rootBranch = await repo.git(["branch", "--show-current"]);
    expect(rootBranch.trim()).toBe("main");
    const worktrees = await repo.git(["worktree", "list", "--porcelain"]);
    expect(worktrees).toContain(path);
  });
});

/**
 * A worktree whose `.git` link file is gone while its directory, holding
 * untracked work, is not: git reports it prunable, yet its own validation still
 * refuses to remove it, `--force` or not, so nothing is lost.
 */
const expectGitToRefuseRemoval = async (force: boolean): Promise<void> => {
  const path = await createManagedWorktree();
  const keptFile = `${path}/untracked.txt`;
  await Bun.write(keptFile, "keep me");
  await removeDirectory(`${path}/.git`, { force: true });
  const listed = await ls(git, fs, { cwd: repo.repoPath });
  expect(listed.data).toContainEqual(
    expect.objectContaining({ branch: BRANCH, path, prunable: true }),
  );

  const result = await rm(git, fs, {
    cwd: repo.repoPath,
    branch: BRANCH,
    force,
    ext: false,
  });

  expect(result.ok).toBe(false);
  expect(result.exitCode).toBe(3);
  expect(result.errorMessage).toContain("validation failed");
  expect(result.errorMessage).toContain(".git' does not exist");
  expect(await fs.exists(keptFile)).toBe(true);
  const worktrees = await repo.git(["worktree", "list", "--porcelain"]);
  expect(worktrees).toContain(path);
};

describe("ディレクトリは残るが .git だけが消えた worktree — git の拒否 (integration)", () => {
  it("--force なしで rm する場合、git が拒否して exit 3 になり、ファイルも登録も残る", () =>
    expectGitToRefuseRemoval(false));

  it("--force 付きで rm する場合も、git が拒否して exit 3 になり、ファイルも登録も残る", () =>
    expectGitToRefuseRemoval(true));
});

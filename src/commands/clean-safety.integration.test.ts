import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createFsPort } from "../infra/fs.ts";
import { createGitPort } from "../infra/git.ts";
import { createTermPort } from "../infra/term.ts";
import { createTestRepo, type TestRepo } from "../testing/repo.ts";
import { clean } from "./clean.ts";
import { jump } from "./jump.ts";
import { root } from "./root.ts";

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

/**
 * A managed worktree for `feat/outer` (a clean `merged` candidate) with a
 * registered worktree for `feat/inner` nested inside its directory.
 */
const createOuterWithNestedWorktree = async (): Promise<{
  readonly outerPath: string;
  readonly innerPath: string;
}> => {
  await repo.git(["branch", "feat/outer"]);
  const outer = await jump(git, fs, {
    cwd: repo.repoPath,
    target: "feat/outer",
    create: true,
  });
  if (outer.path === undefined) {
    throw new Error("expected jump to report a path");
  }
  // The inner branch carries its own unmerged commit, so that it is not a
  // Clean candidate itself.
  const innerPath = `${outer.path}/.claude/worktrees/inner`;
  await repo.git(["worktree", "add", innerPath, "-b", "feat/inner"]);
  await Bun.write(`${innerPath}/inner.txt`, "unmerged");
  await repo.git(["add", "inner.txt"], innerPath);
  await repo.git(["commit", "-m", "unmerged change"], innerPath);
  return { outerPath: outer.path, innerPath };
};

/**
 * Dry-runs `clean` (the outer worktree must be the only candidate), then runs
 * it for real and checks that the outer worktree was skipped with a warning
 * and that neither worktree was touched.
 */
const expectOuterSkipped = async (outerPath: string, innerPath: string): Promise<void> => {
  const options = {
    cwd: repo.repoPath,
    ext: false,
    withBranch: false,
    yes: true,
  };
  const dryRun = await clean(git, fs, term, { ...options, dryRun: true });
  expect(dryRun.data?.candidates).toEqual([
    { branch: "feat/outer", path: outerPath, reason: "merged" },
  ]);

  const result = await clean(git, fs, term, { ...options, dryRun: false });

  expect(result.ok).toBe(true);
  expect(result.data?.removed).toEqual([]);
  expect(result.warnings).toContain(`Skipped ${outerPath}: still contains a registered worktree.`);
  expect(await fs.exists(outerPath)).toBe(true);
  expect(await fs.exists(innerPath)).toBe(true);
  const worktrees = await repo.git(["worktree", "list", "--porcelain"]);
  expect(worktrees).toContain(outerPath);
  expect(worktrees).toContain(innerPath);
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
    const originDir = await mkdtemp(`${tmpdir()}/nuthatch-origin-`);
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

  it("hop root によって detach された holder (branch なし) は clean 候補にしない", async () => {
    await repo.git(["branch", "feat/held-for-clean"]);
    const held = await jump(git, fs, {
      cwd: repo.repoPath,
      target: "feat/held-for-clean",
      create: true,
    });
    expect(held.path).toBeDefined();

    // Swap root onto the branch, which detaches the holder's HEAD (no branch,
    // So it must never be treated as a "branch-less" clean candidate).
    const swapped = await root(git, fs, {
      cwd: repo.repoPath,
      target: "feat/held-for-clean",
    });
    expect(swapped.ok).toBe(true);

    const result = await clean(git, fs, term, {
      cwd: repo.repoPath,
      ext: false,
      withBranch: false,
      dryRun: true,
      yes: false,
    });

    expect(result.ok).toBe(true);
    expect(result.data?.candidates.some((candidate) => candidate.path === held.path)).toBe(false);
  });

  it("merge 済みでも登録済みの worktree を内側に含む候補は、削除されず警告つきで skip される", async () => {
    const { outerPath, innerPath } = await createOuterWithNestedWorktree();

    await expectOuterSkipped(outerPath, innerPath);
  });

  it("内側の worktree の path が ignore され git 単体なら消せる場合も、skip して内側を壊さない", async () => {
    const { outerPath, innerPath } = await createOuterWithNestedWorktree();
    // Ignored, the nested worktree no longer makes `git worktree remove` refuse
    // On its own, so only hop's own guard stands between clean and its files.
    await Bun.write(`${repo.repoPath}/.git/info/exclude`, ".claude/\n");

    await expectOuterSkipped(outerPath, innerPath);
  });
});

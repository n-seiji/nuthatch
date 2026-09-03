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

beforeEach(async () => {
  repo = await createTestRepo();
  savedEnv = { ...process.env };
  Object.assign(process.env, repo.env);
});

afterEach(async () => {
  process.env = savedEnv;
  await repo.cleanup();
});

describe("clean (integration)", () => {
  it("candidate がない場合、空配列を返す", async () => {
    const result = await clean(git, fs, term, {
      cwd: repo.repoPath,
      ext: false,
      withBranch: false,
      dryRun: false,
      yes: true,
    });
    expect(result.ok).toBe(true);
    expect(result.data?.candidates).toEqual([]);
  });

  it("default branch に merge 済みで clean な worktree を候補にし、--yes で削除する", async () => {
    await repo.git(["checkout", "-b", "feat/merged"]);
    await repo.writeFile("merged.txt", "content");
    await repo.git(["add", "merged.txt"]);
    await repo.git(["commit", "-m", "add merged.txt"]);
    await repo.git(["checkout", "main"]);
    await repo.git(["merge", "feat/merged"]);

    const created = await jump(git, fs, term, {
      cwd: repo.repoPath,
      target: "feat/merged",
      create: true,
    });
    expect(created.ok).toBe(true);
    const createdPath = created.path;
    if (createdPath === undefined) {
      throw new Error("expected jump to report a path");
    }

    const dryRun = await clean(git, fs, term, {
      cwd: repo.repoPath,
      ext: false,
      withBranch: false,
      dryRun: true,
      yes: false,
    });
    expect(dryRun.ok).toBe(true);
    expect(dryRun.data?.candidates).toEqual([
      { branch: "feat/merged", path: createdPath, reason: "merged" },
    ]);
    expect(dryRun.data?.removed).toBeUndefined();

    const executed = await clean(git, fs, term, {
      cwd: repo.repoPath,
      ext: false,
      withBranch: false,
      dryRun: false,
      yes: true,
    });
    expect(executed.ok).toBe(true);
    expect(executed.data?.removed).toEqual(["feat/merged"]);

    const branches = await repo.git(["branch", "--list", "feat/merged"]);
    expect(branches.trim().length).toBeGreaterThan(0);
  });

  it("--with-branch で branch も削除する", async () => {
    await repo.git(["checkout", "-b", "feat/merged"]);
    await repo.git(["checkout", "main"]);
    await repo.git(["merge", "feat/merged"]);

    const created = await jump(git, fs, term, {
      cwd: repo.repoPath,
      target: "feat/merged",
      create: true,
    });
    expect(created.ok).toBe(true);

    const executed = await clean(git, fs, term, {
      cwd: repo.repoPath,
      ext: false,
      withBranch: true,
      dryRun: false,
      yes: true,
    });
    expect(executed.ok).toBe(true);
    expect(executed.data?.removed).toEqual(["feat/merged"]);

    const branches = await repo.git(["branch", "--list", "feat/merged"]);
    expect(branches.trim()).toBe("");
  });

  it("merge 済みでも dirty な worktree は候補にしない", async () => {
    await repo.git(["checkout", "-b", "feat/dirty-merged"]);
    await repo.git(["checkout", "main"]);
    await repo.git(["merge", "feat/dirty-merged"]);

    const created = await jump(git, fs, term, {
      cwd: repo.repoPath,
      target: "feat/dirty-merged",
      create: true,
    });
    expect(created.ok).toBe(true);
    await fs.exists(created.path ?? "");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(created.path ?? "", "dirty.txt"), "uncommitted");

    const result = await clean(git, fs, term, {
      cwd: repo.repoPath,
      ext: false,
      withBranch: false,
      dryRun: true,
      yes: false,
    });
    expect(result.data?.candidates).toEqual([]);
  });

  it("upstream が gone で到達可能な commit がない worktree を gone として候補にする", async () => {
    const originDir = await mkdtemp(join(tmpdir(), "nuthatch-origin-"));
    try {
      await repo.git(["init", "--bare", originDir]);
      await repo.git(["remote", "add", "origin", originDir]);
      await repo.git(["push", "origin", "main"]);
      await repo.git(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);

      await repo.git(["branch", "feat/gone"]);
      const created = await jump(git, fs, term, {
        cwd: repo.repoPath,
        target: "feat/gone",
        create: true,
      });
      expect(created.ok).toBe(true);
      const worktreePath = created.path;
      if (worktreePath === undefined) {
        throw new Error("expected jump to report a path");
      }

      const { writeFile } = await import("node:fs/promises");
      await writeFile(join(worktreePath, "squash.txt"), "content");
      await repo.git(["add", "squash.txt"], worktreePath);
      await repo.git(["commit", "-m", "add squash.txt"], worktreePath);
      const commitShaOutput = await repo.git(["rev-parse", "HEAD"], worktreePath);
      const commitSha = commitShaOutput.trim();

      // Simulates a squash/rebase merge: main gets an equivalent-content
      // Commit with a different hash (the "-x" trailer guarantees a distinct
      // Message, hence a distinct hash, regardless of commit timing), so
      // Feat/gone is never a literal ancestor of main even though its change
      // Already landed there.
      await repo.git(["cherry-pick", "-x", commitSha]);
      // Origin/main must reflect the cherry-picked commit too, or the
      // Equivalent-patch check below has nothing to compare against.
      await repo.git(["push", "origin", "main"]);

      await repo.git(["push", "-u", "origin", "feat/gone"]);
      await repo.git(["push", "origin", "--delete", "feat/gone"]);
      await repo.git(["fetch", "--prune", "origin"]);

      const result = await clean(git, fs, term, {
        cwd: repo.repoPath,
        ext: false,
        withBranch: false,
        dryRun: true,
        yes: false,
      });
      expect(result.data?.candidates).toEqual([
        { branch: "feat/gone", path: worktreePath, reason: "gone" },
      ]);
    } finally {
      await rm(originDir, { recursive: true, force: true });
    }
  });

  it("prunable な worktree (ディレクトリが手動で消えた) を無条件で候補にする", async () => {
    await repo.git(["branch", "feat/prunable"]);
    const created = await jump(git, fs, term, {
      cwd: repo.repoPath,
      target: "feat/prunable",
      create: true,
    });
    expect(created.ok).toBe(true);
    await rm(created.path ?? "", { recursive: true, force: true });

    const result = await clean(git, fs, term, {
      cwd: repo.repoPath,
      ext: false,
      withBranch: false,
      dryRun: true,
      yes: false,
    });
    expect(result.data?.candidates).toEqual([
      expect.objectContaining({ branch: "feat/prunable", reason: "prunable" }),
    ]);
  });

  it("非 TTY で --yes も --dry-run も無ければ usage error (exit 2) を返す", async () => {
    await repo.git(["checkout", "-b", "feat/merged"]);
    await repo.git(["checkout", "main"]);
    await repo.git(["merge", "feat/merged"]);
    await jump(git, fs, term, {
      cwd: repo.repoPath,
      target: "feat/merged",
      create: true,
    });

    const result = await clean(git, fs, term, {
      cwd: repo.repoPath,
      ext: false,
      withBranch: false,
      dryRun: false,
      yes: false,
    });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
  });
});

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createFsPort } from "../infra/fs.ts";
import { createGitPort } from "../infra/git.ts";
import { createTermPort } from "../infra/term.ts";
import { createTestRepo, type TestRepo } from "../testing/repo.ts";
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

describe("root (integration) — nested worktree dirty exclusion / rollback warnings", () => {
  it("root 配下にネストした登録済み worktree があっても root は dirty 扱いにならない", async () => {
    await repo.git(["worktree", "add", "--detach", ".claude/worktrees/x"]);
    await repo.git(["branch", "feat/nested-ok"]);

    const result = await root(git, fs, {
      cwd: repo.repoPath,
      target: "feat/nested-ok",
    });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      branch: "feat/nested-ok",
      switched: true,
      detachedHolder: null,
    });
  });

  it("ネストした worktree があっても、root 自身に真の変更があれば dirty と判定して拒否する", async () => {
    await repo.git(["worktree", "add", "--detach", ".claude/worktrees/x"]);
    await repo.writeFile("dirty.txt", "uncommitted");
    await repo.git(["branch", "feat/nested-dirty"]);

    const result = await root(git, fs, {
      cwd: repo.repoPath,
      target: "feat/nested-dirty",
    });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);
    const branchOutput = await repo.git(["branch", "--show-current"]);
    const branch = branchOutput.trim();
    expect(branch).toBe("main");
  });

  it("root と holder 両方の rollback が失敗したら、両方の警告を残しつつ元の失敗の exit code を保つ", async () => {
    await repo.git(["branch", "feat/held-rollback-fail"]);
    const held = await jump(git, fs, term, {
      cwd: repo.repoPath,
      target: "feat/held-rollback-fail",
      create: true,
    });
    expect(held.ok).toBe(true);

    const heldRealPath = await fs.realpath(held.path as string);
    const rootRealPath = await fs.realpath(repo.repoPath);
    const failingGit: typeof git = {
      ...git,
      switchBranch: async (cwd, ref, opts) => {
        const resolvedCwd = await fs.realpath(cwd).catch(() => cwd);
        // Fail the root-clone's switch to the target branch (the original
        // Failure this test is injecting)...
        if (ref === "feat/held-rollback-fail" && resolvedCwd !== heldRealPath) {
          throw new Error("injected failure");
        }
        // ...and also fail every rollback attempt (both root's and holder's
        // Best-effort restore to their previous branch).
        if (
          (resolvedCwd === rootRealPath && ref === "main") ||
          (resolvedCwd === heldRealPath && ref === "feat/held-rollback-fail")
        ) {
          throw new Error("injected rollback failure");
        }
        await git.switchBranch(cwd, ref, opts);
      },
    };

    const result = await root(failingGit, fs, {
      cwd: repo.repoPath,
      target: "feat/held-rollback-fail",
    });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);
    expect(result.errorMessage).toContain("injected failure");
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings?.[0]).toContain(rootRealPath);
    expect(result.warnings?.[0]).toContain("detached HEAD");
    expect(result.warnings?.[1]).toContain(held.path as string);
    expect(result.warnings?.[1]).toContain("detached HEAD");
  });

  it("root 配下にネストした worktree 自身に真の変更があれば、その worktree 自身は dirty と判定する (exclusion は自分の祖先に対してではなく自分の内側にのみ効く)", async () => {
    const held = await jump(git, fs, term, {
      cwd: repo.repoPath,
      target: "swap-dirty",
      create: true,
    });
    expect(held.ok).toBe(true);
    // Move the created worktree under root's own tree, mirroring
    // `.claude/worktrees/<branch>` (an agent-created nested worktree), and
    // Give it a genuine uncommitted change of its own.
    const nestedPath = `${repo.repoPath}/.claude/worktrees/swap-dirty`;
    const { mkdir } = await import("node:fs/promises");
    await mkdir(`${repo.repoPath}/.claude/worktrees`, { recursive: true });
    await repo.git(["worktree", "move", held.path as string, nestedPath]);
    await Bun.write(`${nestedPath}/a.txt`, "modified");

    const rootResult = await root(git, fs, {
      cwd: repo.repoPath,
      target: "swap-dirty",
    });
    expect(rootResult.ok).toBe(false);
    expect(rootResult.exitCode).toBe(3);
    // Confirm hop's own dirty check rejected this (exit 3 alone could also come from git's own safety net).
    expect(rootResult.errorMessage).toContain("has uncommitted or untracked changes");
    const rootBranchOutput = await repo.git(["branch", "--show-current"]);
    expect(rootBranchOutput.trim()).toBe("main");
    const holderBranchOutput = await repo.git(["branch", "--show-current"], nestedPath);
    expect(holderBranchOutput.trim()).toBe("swap-dirty");

    const rmResult = await rm(git, fs, {
      cwd: repo.repoPath,
      branch: "swap-dirty",
      force: false,
      ext: false,
    });
    expect(rmResult.ok).toBe(false);
    expect(rmResult.exitCode).toBe(3);
    // Same reasoning: confirm hop rejected this before git's own `git worktree remove` safety net could.
    expect(rmResult.errorMessage).toContain(
      "has uncommitted or untracked changes. Use --force to remove anyway.",
    );
    expect(rmResult.errorMessage).not.toContain("contains modified or untracked files");
  });
});

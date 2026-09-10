import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createFsPort } from "../infra/fs.ts";
import { createGitPort } from "../infra/git.ts";
import { createTermPort } from "../infra/term.ts";
import { createTestRepo, type TestRepo } from "../testing/repo.ts";
import { jump } from "./jump.ts";
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

describe("root (integration)", () => {
  it("target なしは root clone の path を現在の branch とともに返す", async () => {
    const result = await root(git, fs, { cwd: repo.repoPath });
    expect(result.ok).toBe(true);
    expect(result.path).toBe(await fs.realpath(repo.repoPath));
    expect(result.data).toEqual({
      branch: "main",
      switched: false,
      detachedHolder: null,
    });
  });

  it("local branch へ切り替えると root の branch が変わる", async () => {
    await repo.git(["branch", "feat/verify"]);
    const result = await root(git, fs, {
      cwd: repo.repoPath,
      target: "feat/verify",
    });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      branch: "feat/verify",
      switched: true,
      detachedHolder: null,
    });
    const branchOutput = await repo.git(["branch", "--show-current"]);
    const branch = branchOutput.trim();
    expect(branch).toBe("feat/verify");
  });

  it("root が dirty なら切替を拒否する (exit 3)", async () => {
    await repo.writeFile("dirty.txt", "uncommitted");
    await repo.git(["branch", "feat/verify"]);
    const result = await root(git, fs, {
      cwd: repo.repoPath,
      target: "feat/verify",
    });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);
    const branchOutput = await repo.git(["branch", "--show-current"]);
    const branch = branchOutput.trim();
    expect(branch).toBe("main");
  });

  it("対象 branch を他 worktree (holder) が checkout 済みでも clean なら detach して swap する", async () => {
    await repo.git(["branch", "feat/held"]);
    const held = await jump(git, fs, term, {
      cwd: repo.repoPath,
      target: "feat/held",
      create: true,
    });
    expect(held.ok).toBe(true);

    const result = await root(git, fs, {
      cwd: repo.repoPath,
      target: "feat/held",
    });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      branch: "feat/held",
      switched: true,
      detachedHolder: held.path,
    });
    expect(result.warnings?.[0]).toContain(held.path as string);

    const rootBranchOutput = await repo.git(["branch", "--show-current"]);
    const rootBranch = rootBranchOutput.trim();
    expect(rootBranch).toBe("feat/held");
    const holderBranchOutput = await repo.git(["branch", "--show-current"], held.path);
    const holderBranch = holderBranchOutput.trim();
    expect(holderBranch).toBe("");
  });

  it("holder が dirty なら detach せず swap を拒否する", async () => {
    await repo.git(["branch", "feat/held-dirty"]);
    const held = await jump(git, fs, term, {
      cwd: repo.repoPath,
      target: "feat/held-dirty",
      create: true,
    });
    expect(held.ok).toBe(true);
    await Bun.write(`${held.path}/untracked.txt`, "dirty");

    const result = await root(git, fs, {
      cwd: repo.repoPath,
      target: "feat/held-dirty",
    });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);
    expect(result.errorMessage).toContain(held.path as string);

    const rootBranchOutput = await repo.git(["branch", "--show-current"]);
    const rootBranch = rootBranchOutput.trim();
    expect(rootBranch).toBe("main");
    const holderBranchOutput = await repo.git(["branch", "--show-current"], held.path);
    const holderBranch = holderBranchOutput.trim();
    expect(holderBranch).toBe("feat/held-dirty");
  });

  it("holder が git でロック中なら detach せず swap を拒否する", async () => {
    await repo.git(["branch", "feat/held-locked"]);
    const held = await jump(git, fs, term, {
      cwd: repo.repoPath,
      target: "feat/held-locked",
      create: true,
    });
    expect(held.ok).toBe(true);
    await repo.git(["worktree", "lock", held.path as string, "--reason", "in use"]);

    const result = await root(git, fs, {
      cwd: repo.repoPath,
      target: "feat/held-locked",
    });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);

    const rootBranchOutput = await repo.git(["branch", "--show-current"]);
    const rootBranch = rootBranchOutput.trim();
    expect(rootBranch).toBe("main");
    const holderBranchOutput = await repo.git(["branch", "--show-current"], held.path);
    const holderBranch = holderBranchOutput.trim();
    expect(holderBranch).toBe("feat/held-locked");
  });

  it("holder を detach した後に root の switch が失敗したら holder を元の branch に rollback する", async () => {
    await repo.git(["branch", "feat/held-rollback"]);
    const held = await jump(git, fs, term, {
      cwd: repo.repoPath,
      target: "feat/held-rollback",
      create: true,
    });
    expect(held.ok).toBe(true);

    const heldRealPath = await fs.realpath(held.path as string);
    const failingGit: typeof git = {
      ...git,
      switchBranch: async (cwd, ref, opts) => {
        // Fail specifically the root-clone's switch to the target branch —
        // Not the rollback switchBranch call on the holder itself (same ref,
        // Different cwd), which must succeed for the rollback to work.
        const resolvedCwd = await fs.realpath(cwd).catch(() => cwd);
        if (ref === "feat/held-rollback" && resolvedCwd !== heldRealPath) {
          throw new Error("injected failure");
        }
        await git.switchBranch(cwd, ref, opts);
      },
    };

    const result = await root(failingGit, fs, {
      cwd: repo.repoPath,
      target: "feat/held-rollback",
    });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);

    const rootBranchOutput = await repo.git(["branch", "--show-current"]);
    const rootBranch = rootBranchOutput.trim();
    expect(rootBranch).toBe("main");
    const holderBranchOutput = await repo.git(["branch", "--show-current"], held.path);
    const holderBranch = holderBranchOutput.trim();
    expect(holderBranch).toBe("feat/held-rollback");
  });

  it("`-` で直前の branch に戻る (@{-1})", async () => {
    await repo.git(["branch", "feat/verify"]);
    await root(git, fs, { cwd: repo.repoPath, target: "feat/verify" });
    const back = await root(git, fs, { cwd: repo.repoPath, target: "-" });
    expect(back.ok).toBe(true);
    expect(back.data?.branch).toBeNull();
    const branchOutput = await repo.git(["branch", "--show-current"]);
    const branch = branchOutput.trim();
    expect(branch).toBe("main");
  });

  it("swap 後の `-` は root の branch だけ戻し、holder は detached のままにする", async () => {
    await repo.git(["branch", "feat/held-back"]);
    const held = await jump(git, fs, term, {
      cwd: repo.repoPath,
      target: "feat/held-back",
      create: true,
    });
    expect(held.ok).toBe(true);

    const swapped = await root(git, fs, {
      cwd: repo.repoPath,
      target: "feat/held-back",
    });
    expect(swapped.ok).toBe(true);

    const back = await root(git, fs, { cwd: repo.repoPath, target: "-" });
    expect(back.ok).toBe(true);
    expect(back.data?.branch).toBeNull();

    const rootBranchOutput = await repo.git(["branch", "--show-current"]);
    const rootBranch = rootBranchOutput.trim();
    expect(rootBranch).toBe("main");
    // The holder was never re-attached — it stays on detached HEAD.
    const holderBranchOutput = await repo.git(["branch", "--show-current"], held.path);
    const holderBranch = holderBranchOutput.trim();
    expect(holderBranch).toBe("");
  });
});

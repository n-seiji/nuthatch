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
    expect(result.data).toEqual({ branch: "main", switched: false });
  });

  it("local branch へ切り替えると root の branch が変わる", async () => {
    await repo.git(["branch", "feat/verify"]);
    const result = await root(git, fs, {
      cwd: repo.repoPath,
      target: "feat/verify",
    });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ branch: "feat/verify", switched: true });
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

  it("対象 branch を他 worktree が checkout 済みなら swap せず拒否する", async () => {
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
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);
    expect(result.errorMessage).toContain(held.path);
    const branchOutput = await repo.git(["branch", "--show-current"]);
    const branch = branchOutput.trim();
    expect(branch).toBe("main");
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
});

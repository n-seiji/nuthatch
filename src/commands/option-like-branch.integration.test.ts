import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createFsPort } from "../infra/fs.ts";
import { createGitPort } from "../infra/git.ts";
import { createTestRepo, type TestRepo } from "../testing/repo.ts";
import { jump } from "./jump.ts";
import { rm } from "./rm.ts";
import { root } from "./root.ts";

const git = createGitPort();
const fs = createFsPort();

let repo: TestRepo;
let savedEnv: NodeJS.ProcessEnv;

beforeEach(async () => {
  repo = await createTestRepo();
  savedEnv = { ...process.env };
  Object.assign(process.env, repo.env);
  await repo.git(["update-ref", "refs/heads/-M", "HEAD"]);
});

afterEach(async () => {
  process.env = savedEnv;
  await repo.cleanup();
});

const currentBranch = async (): Promise<string> => {
  const out = await repo.git(["rev-parse", "--abbrev-ref", "HEAD"]);
  return out.trim();
};

describe("option-like branch names (integration)", () => {
  it("jump --create は '-M' を exit 2 で拒否し、現在の branch を変更しない", async () => {
    const result = await jump(git, fs, {
      cwd: repo.repoPath,
      target: "-M",
      create: true,
    });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(await currentBranch()).toBe("main");
  });

  it("jump は option-like な --track も exit 2 で拒否する", async () => {
    const result = await jump(git, fs, {
      cwd: repo.repoPath,
      target: "feat/x",
      create: true,
      track: "-M",
    });
    expect(result.exitCode).toBe(2);
    expect(await currentBranch()).toBe("main");
  });

  it("jump '-' は option-like 拒否の対象外 (OLDPWD の経路を維持する)", async () => {
    const result = await jump(git, fs, {
      cwd: repo.repoPath,
      target: "-",
      create: false,
    });
    expect(result.exitCode).not.toBe(2);
  });

  it("root '-M' は exit 2 で拒否し、root の branch を変更しない", async () => {
    const result = await root(git, fs, { cwd: repo.repoPath, target: "-M" });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(await currentBranch()).toBe("main");
  });

  it("root は option-like な --track も exit 2 で拒否する", async () => {
    const result = await root(git, fs, {
      cwd: repo.repoPath,
      target: "feat/x",
      track: "-c",
    });
    expect(result.exitCode).toBe(2);
  });

  it("rm '-M' は exit 2 で拒否し、local branch '-M' を残す", async () => {
    const result = await rm(git, fs, {
      cwd: repo.repoPath,
      branch: "-M",
      force: true,
    });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(await repo.git(["branch", "--list", "--", "-M"])).toContain("-M");
  });

  it("GitPort は '-M' を option でなく ref として扱う (多層防御)", async () => {
    expect(await git.isAncestor(repo.repoPath, "-M", "main")).toBe(true);
    expect(await git.hasEquivalentCommits(repo.repoPath, "-M", "main")).toBe(true);
    await git.deleteBranch(repo.repoPath, "-M");
    expect(await currentBranch()).toBe("main");
    expect(await repo.git(["branch", "--list", "--", "-M"])).toBe("");
  });
});

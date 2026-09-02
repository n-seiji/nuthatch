import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createFsPort } from "../infra/fs.ts";
import { createGitPort } from "../infra/git.ts";
import { createTermPort } from "../infra/term.ts";
import { type TestRepo, createTestRepo } from "../testing/repo.ts";
import { jump } from "./jump.ts";
import { ls } from "./ls.ts";
import { rm } from "./rm.ts";

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

describe("jump → ls → rm (integration)", () => {
  it("非TTY で存在しない branch に --create なしで jump すると exit 3 になる", async () => {
    const result = await jump(git, fs, term, {
      cwd: repo.repoPath,
      target: "feat/new",
      create: false,
    });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);
  });

  it("--create を指定すると worktree を作成して path を返す", async () => {
    const result = await jump(git, fs, term, {
      cwd: repo.repoPath,
      target: "feat/new",
      create: true,
    });
    expect(result.ok).toBe(true);
    expect(result.data?.created).toBe(true);
    expect(result.path).toContain("_worktree");
    expect(result.path).toContain("feat__new");
  });

  it("既に worktree がある branch に jump すると同じ path を返す (create-or-jump)", async () => {
    const created = await jump(git, fs, term, {
      cwd: repo.repoPath,
      target: "feat/new",
      create: true,
    });
    const jumped = await jump(git, fs, term, {
      cwd: repo.repoPath,
      target: "feat/new",
      create: false,
    });
    expect(jumped.ok).toBe(true);
    expect(jumped.data?.created).toBe(false);
    expect(jumped.path).toBe(created.path);
  });

  it("ls は root と作成した worktree の両方を返す", async () => {
    await jump(git, fs, term, {
      cwd: repo.repoPath,
      target: "feat/new",
      create: true,
    });
    const result = await ls(git, fs, { cwd: repo.repoPath });
    expect(result.ok).toBe(true);
    const kinds = result.data?.map((wt) => wt.kind).toSorted();
    expect(kinds).toEqual(["managed", "root"]);
  });

  it("dirty な worktree を --force なしで rm すると exit 3 になる", async () => {
    const created = await jump(git, fs, term, {
      cwd: repo.repoPath,
      target: "feat/dirty",
      create: true,
    });
    const filePath = `${created.path}/untracked.txt`;
    await Bun.write(filePath, "dirty");

    const result = await rm(git, fs, {
      cwd: repo.repoPath,
      branch: "feat/dirty",
      force: false,
      ext: false,
    });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);
  });

  it("clean な worktree は rm で削除できる", async () => {
    await jump(git, fs, term, {
      cwd: repo.repoPath,
      target: "feat/clean",
      create: true,
    });
    const result = await rm(git, fs, {
      cwd: repo.repoPath,
      branch: "feat/clean",
      force: false,
      ext: false,
    });
    expect(result.ok).toBe(true);

    const after = await ls(git, fs, { cwd: repo.repoPath });
    const kinds = after.data?.map((wt) => wt.kind).toSorted();
    expect(kinds).toEqual(["root"]);
  });

  it("予約語と同名の branch も -- でエスケープして扱える", async () => {
    // The domain layer itself has no notion of reserved words — that's a
    // Cli.ts concern — so this exercises the command directly with "ls" as
    // A literal branch name to prove commands never special-case it.
    const created = await jump(git, fs, term, {
      cwd: repo.repoPath,
      target: "ls",
      create: true,
    });
    expect(created.ok).toBe(true);
    expect(created.data?.branch).toBe("ls");
  });

  it("root は root clone の path を返す", async () => {
    const result = await jump(git, fs, term, {
      cwd: repo.repoPath,
      target: "root",
      create: false,
    });
    expect(result.ok).toBe(true);
    expect(result.path).toBe(await fs.realpath(repo.repoPath));
  });
});

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

  it("clean な external worktree は rm で削除できる (--ext なしでよい)", async () => {
    await repo.git(["branch", "feat/ext"]);
    const externalPath = `${repo.rootDir}/agent-worktrees/feat-ext`;
    await repo.git(["worktree", "add", externalPath, "feat/ext"]);

    const result = await rm(git, fs, {
      cwd: repo.repoPath,
      branch: "feat/ext",
      force: false,
      ext: false,
    });
    expect(result.ok).toBe(true);

    const after = await ls(git, fs, { cwd: repo.repoPath });
    const kinds = after.data?.map((wt) => wt.kind).toSorted();
    expect(kinds).toEqual(["root"]);
  });

  it("dirty な external worktree を --force なしで rm すると exit 3 になる", async () => {
    await repo.git(["branch", "feat/ext-dirty"]);
    const externalPath = `${repo.rootDir}/agent-worktrees/feat-ext-dirty`;
    await repo.git(["worktree", "add", externalPath, "feat/ext-dirty"]);
    await Bun.write(`${externalPath}/untracked.txt`, "dirty");

    const result = await rm(git, fs, {
      cwd: repo.repoPath,
      branch: "feat/ext-dirty",
      force: false,
      ext: false,
    });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);
  });

  it("dirty な external worktree でも --force なら rm できる", async () => {
    await repo.git(["branch", "feat/ext-force"]);
    const externalPath = `${repo.rootDir}/agent-worktrees/feat-ext-force`;
    await repo.git(["worktree", "add", externalPath, "feat/ext-force"]);
    await Bun.write(`${externalPath}/untracked.txt`, "dirty");

    const result = await rm(git, fs, {
      cwd: repo.repoPath,
      branch: "feat/ext-force",
      force: true,
      ext: false,
    });
    expect(result.ok).toBe(true);
  });

  it("git がロック中の worktree は --force でも rm を拒否する (exit 3)", async () => {
    await repo.git(["branch", "feat/locked"]);
    const lockedPath = `${repo.rootDir}/agent-worktrees/feat-locked`;
    await repo.git(["worktree", "add", lockedPath, "feat/locked"]);
    await repo.git(["worktree", "lock", lockedPath, "--reason", "in use by an agent"]);

    const result = await rm(git, fs, {
      cwd: repo.repoPath,
      branch: "feat/locked",
      force: true,
      ext: false,
    });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);
    // Must be hop's own refusal message, not git's — hop never even attempts
    // `git worktree remove` on a locked target, so git's own "is already
    // Used by worktree" / lock-related wording must never leak through.
    expect(result.errorMessage).toContain("is locked by git");
    expect(result.errorMessage).not.toContain("contains modified or untracked files");

    const after = await ls(git, fs, { cwd: repo.repoPath });
    const kinds = after.data?.map((wt) => wt.kind).toSorted();
    expect(kinds).toEqual(["external", "root"]);
  });

  it("中にネストした登録済み worktree (locked かつ dirty) を含む親は --force でも rm を拒否する (exit 3)", async () => {
    // Regression for the "hop's own locked-worktree refusal can be bypassed
    // Through a parent worktree" bug: removing the parent used to delete the
    // Child's files too, and hop's message must be the reason (not git's own
    // "contains modified or untracked files" text) — see AGENTS.md's "always
    // Refuse git-locked, --force or not" safety rule.
    await repo.git(["branch", "parent"]);
    const parentPath = `${repo.rootDir}/agent-worktrees/parent`;
    await repo.git(["worktree", "add", parentPath, "parent"]);
    const childPath = `${parentPath}/nested-child`;
    await repo.git(["worktree", "add", childPath, "-b", "child"]);
    await repo.git(["worktree", "lock", childPath, "--reason", "in use"]);
    await Bun.write(`${childPath}/untracked.txt`, "dirty");

    const result = await rm(git, fs, {
      cwd: repo.repoPath,
      branch: "parent",
      force: true,
      ext: false,
    });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);
    expect(result.errorMessage).toContain("still contains");
    expect(result.errorMessage).not.toContain("contains modified or untracked files");
    expect(result.errorMessage).not.toContain("is already used by worktree");

    const after = await ls(git, fs, { cwd: repo.repoPath });
    expect(after.data?.some((wt) => wt.branch === "parent")).toBe(true);
    expect(after.data?.some((wt) => wt.branch === "child")).toBe(true);
  });

  it("中身が空の (ネストした worktree を含まない) worktree は通常どおり rm できる", async () => {
    await repo.git(["branch", "plain"]);
    const plainPath = `${repo.rootDir}/agent-worktrees/plain`;
    await repo.git(["worktree", "add", plainPath, "plain"]);

    const result = await rm(git, fs, {
      cwd: repo.repoPath,
      branch: "plain",
      force: false,
      ext: false,
    });
    expect(result.ok).toBe(true);
  });

  it("--ext は非推奨の no-op として動作し、成功時に警告を出す", async () => {
    await repo.git(["branch", "feat/ext-deprecated"]);
    const externalPath = `${repo.rootDir}/agent-worktrees/feat-ext-deprecated`;
    await repo.git(["worktree", "add", externalPath, "feat/ext-deprecated"]);

    const result = await rm(git, fs, {
      cwd: repo.repoPath,
      branch: "feat/ext-deprecated",
      force: false,
      ext: true,
    });
    expect(result.ok).toBe(true);
    expect(result.warnings?.some((warning) => warning.includes("--ext is deprecated"))).toBe(true);
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
  // "Root" as a jump target is covered by commands/root.integration.test.ts
  // Now — cli.ts dispatches "root" to commands/root.ts before jump ever runs.
});

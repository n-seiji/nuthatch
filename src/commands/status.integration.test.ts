import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { rm as rmDir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createFsPort } from "../infra/fs.ts";
import { createGitPort } from "../infra/git.ts";
import { createTestRepo, type TestRepo } from "../testing/repo.ts";
import { jump } from "./jump.ts";
import { status } from "./status.ts";

const git = createGitPort();
const fs = createFsPort();

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

const createWorktree = async (branch: string): Promise<string> => {
  const result = await jump(git, fs, { cwd: repo.repoPath, target: branch, create: true });
  if (result.path === undefined) {
    throw new Error(`could not create ${branch}: ${result.errorMessage ?? ""}`);
  }
  return result.path;
};

describe("status (integration)", () => {
  it("branch を指定すると、その worktree の変更・最終コミットを返す", async () => {
    const path = await createWorktree("feat/status");
    await writeFile(join(path, "README.md"), "changed\n");
    await writeFile(join(path, "new.txt"), "new\n");

    const result = await status(git, fs, { cwd: repo.repoPath, branch: "feat/status" });

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      branch: "feat/status",
      kind: "managed",
      dirty: true,
      upstream: null,
      lastCommit: { subject: "initial commit" },
    });
    expect(result.data?.changes).toEqual([
      { status: " M", path: "README.md" },
      { status: "??", path: "new.txt" },
    ]);
  });

  it("branch を省略すると cwd を含む worktree を返す", async () => {
    const path = await createWorktree("feat/here");

    const result = await status(git, fs, { cwd: path });

    expect(result.data).toMatchObject({ branch: "feat/here", dirty: false, changes: [] });
  });

  it("root の中に入れ子の worktree があっても、その中身を root の変更に数えない", async () => {
    await repo.git(["worktree", "add", "-b", "feat/nested", join(repo.repoPath, "nested")]);

    const result = await status(git, fs, { cwd: repo.repoPath, branch: "main" });

    expect(result.data).toMatchObject({ kind: "root", dirty: false, changes: [] });
  });

  it("main に取り込み済みの managed worktree は cleanReason が merged になる", async () => {
    await createWorktree("feat/merged");

    const result = await status(git, fs, { cwd: repo.repoPath, branch: "feat/merged" });

    expect(result.data?.cleanReason).toBe("merged");
  });

  it("ディレクトリが消えた worktree でも最終コミットは返し、変更は空", async () => {
    const path = await createWorktree("feat/gone");
    await rmDir(path, { recursive: true, force: true });

    const result = await status(git, fs, { cwd: repo.repoPath, branch: "feat/gone" });

    expect(result.data).toMatchObject({
      prunable: true,
      dirty: false,
      changes: [],
      lastCommit: { subject: "initial commit" },
      cleanReason: "prunable",
    });
  });

  it("worktree のない branch は exit 1 で理由を返す", async () => {
    const result = await status(git, fs, { cwd: repo.repoPath, branch: "nope" });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.errorMessage).toContain('No worktree found for branch "nope"');
  });
});

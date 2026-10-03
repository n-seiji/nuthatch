import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { createFsPort } from "../infra/fs.ts";
import { createGitPort } from "../infra/git.ts";
import { createTestRepo, type TestRepo } from "../testing/repo.ts";
import { ls } from "./ls.ts";

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

describe("ls (integration)", () => {
  it("bare worktree の場合、dirty は null ではなく false になる", async () => {
    const barePath = join(repo.rootDir, "bare.git");
    await repo.git(["clone", "--bare", repo.repoPath, barePath]);

    const result = await ls(git, fs, { cwd: barePath });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual([expect.objectContaining({ bare: true, dirty: false })]);
  });
});

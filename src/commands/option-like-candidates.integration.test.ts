import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { createFsPort } from "../infra/fs.ts";
import { createGitPort } from "../infra/git.ts";
import { createTermPort } from "../infra/term.ts";
import { createTestRepo, type TestRepo } from "../testing/repo.ts";
import { clean } from "./clean.ts";
import { pick } from "./pick.ts";

const git = createGitPort();
const fs = createFsPort();
const term = createTermPort();

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

describe("option-like branch names in candidate lists (integration)", () => {
  it("pick は local / remote の '-M' を candidate から除外する", async () => {
    const remotePath = join(repo.rootDir, "remote.git");
    await repo.git(["init", "--bare", "--initial-branch=main", remotePath]);
    await repo.git(["remote", "add", "origin", remotePath]);
    await repo.git(["push", "origin", "main", "HEAD:refs/heads/-c"]);
    await repo.git(["branch", "feat/ok"]);

    const result = await pick(git, fs, { cwd: repo.repoPath });
    const creatable = (result.data?.candidates ?? []).flatMap((candidate) =>
      candidate.kind === "creatable" ? [candidate.branch] : [],
    );
    expect(creatable).toContain("feat/ok");
    expect(creatable).not.toContain("-M");
    expect(creatable).not.toContain("-c");
  });

  it("clean は branch が '-M' の merge 済み worktree を候補にしない", async () => {
    const wtPath = join(repo.rootDir, "external-dash");
    await repo.git(["worktree", "add", "--detach", wtPath]);
    await repo.git(["symbolic-ref", "HEAD", "refs/heads/-M"], wtPath);

    const result = await clean(git, fs, term, {
      cwd: repo.repoPath,
      ext: true,
      withBranch: true,
      dryRun: true,
      yes: true,
    });
    expect(result.ok).toBe(true);
    expect(result.data?.candidates).toEqual([]);
  });
});

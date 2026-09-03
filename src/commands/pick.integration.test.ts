import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { createFsPort } from "../infra/fs.ts";
import { createGitPort } from "../infra/git.ts";
import { createTermPort } from "../infra/term.ts";
import { createTestRepo, type TestRepo } from "../testing/repo.ts";
import { jump } from "./jump.ts";
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
});

afterEach(async () => {
  process.env = savedEnv;
  await repo.cleanup();
});

describe("pick (integration)", () => {
  it("root のみの repo では root candidate を 1 件返す", async () => {
    const result = await pick(git, fs, { cwd: repo.repoPath });
    expect(result.ok).toBe(true);
    expect(result.data?.candidates).toEqual([
      expect.objectContaining({ kind: "worktree", dirty: false }),
    ]);
  });

  it("worktree 未作成の local branch を creatable candidate として含める", async () => {
    await repo.git(["branch", "feat/untouched"]);
    const result = await pick(git, fs, { cwd: repo.repoPath });
    expect(result.data?.candidates).toContainEqual({
      kind: "creatable",
      branch: "feat/untouched",
      source: "local",
    });
  });

  it("jump --create で作った worktree は worktree candidate になり creatable からは消える", async () => {
    await repo.git(["branch", "feat/soon"]);
    await jump(git, fs, term, {
      cwd: repo.repoPath,
      target: "feat/soon",
      create: true,
    });
    const result = await pick(git, fs, { cwd: repo.repoPath });
    const branches = result.data?.candidates.map((candidate) =>
      candidate.kind === "worktree" ? candidate.worktree.branch : candidate.branch,
    );
    expect(branches).toContain("feat/soon");
    expect(result.data?.candidates).not.toContainEqual(
      expect.objectContaining({ kind: "creatable", branch: "feat/soon" }),
    );
  });

  it("dirty な worktree は dirty: true になる", async () => {
    const created = await jump(git, fs, term, {
      cwd: repo.repoPath,
      target: "feat/dirty-pick",
      create: true,
    });
    await Bun.write(`${created.path}/untracked.txt`, "dirty");
    const result = await pick(git, fs, { cwd: repo.repoPath });
    const dirtyEntry = result.data?.candidates.find(
      (candidate) =>
        candidate.kind === "worktree" && candidate.worktree.branch === "feat/dirty-pick",
    );
    expect(dirtyEntry).toMatchObject({ dirty: true });
  });

  it("bare worktree は dirty: null になる", async () => {
    const barePath = join(repo.rootDir, "bare.git");
    await repo.git(["clone", "--bare", repo.repoPath, barePath]);

    const result = await pick(git, fs, { cwd: barePath });

    const bareEntry = result.data?.candidates.find(
      (candidate) => candidate.kind === "worktree" && candidate.worktree.bare,
    );
    expect(bareEntry).toMatchObject({ kind: "worktree", dirty: null });
  });
});

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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

  it("upstream に対する ahead / behind を branch ごとに返し、gone と upstream 無しは null にする", async () => {
    const originDir = await mkdtemp(join(tmpdir(), "nuthatch-origin-"));
    try {
      await repo.git(["init", "--bare", originDir]);
      await repo.git(["remote", "add", "origin", originDir]);
      await repo.git(["push", "-u", "origin", "main"]);

      const addWorktree = async (branch: string): Promise<string> => {
        const path = join(repo.rootDir, branch);
        await repo.git(["worktree", "add", "-b", branch, path]);
        return path;
      };
      const commit = async (cwd: string, file: string): Promise<void> => {
        await writeFile(join(cwd, file), file);
        await repo.git(["add", file], cwd);
        await repo.git(["commit", "-m", file], cwd);
      };

      const aheadPath = await addWorktree("ahead");
      await repo.git(["push", "-u", "origin", "ahead"], aheadPath);
      await commit(aheadPath, "a1.txt");
      await commit(aheadPath, "a2.txt");

      const behindPath = await addWorktree("behind");
      await commit(behindPath, "b1.txt");
      await repo.git(["push", "-u", "origin", "behind"], behindPath);
      await repo.git(["reset", "--hard", "HEAD~1"], behindPath);

      const gonePath = await addWorktree("gone");
      await repo.git(["push", "-u", "origin", "gone"], gonePath);
      await repo.git(["push", "origin", "--delete", "gone"]);
      await repo.git(["fetch", "--prune", "origin"]);

      await addWorktree("local-only");

      const result = await ls(git, fs, { cwd: repo.repoPath });

      const remoteOf = (branch: string) => {
        const entry = result.data?.find((candidate) => candidate.branch === branch);
        return { ahead: entry?.ahead, behind: entry?.behind };
      };
      expect(remoteOf("main")).toEqual({ ahead: 0, behind: 0 });
      expect(remoteOf("ahead")).toEqual({ ahead: 2, behind: 0 });
      expect(remoteOf("behind")).toEqual({ ahead: 0, behind: 1 });
      expect(remoteOf("gone")).toEqual({ ahead: null, behind: null });
      expect(remoteOf("local-only")).toEqual({ ahead: null, behind: null });
    } finally {
      await rm(originDir, { recursive: true, force: true });
    }
  });
});

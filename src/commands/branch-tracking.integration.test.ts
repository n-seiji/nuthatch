import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { CommandResult } from "../domain/result.ts";
import { createFsPort } from "../infra/fs.ts";
import { createGitPort } from "../infra/git.ts";
import { createTestRepo, type TestRepo } from "../testing/repo.ts";
import { jump } from "./jump.ts";
import { root } from "./root.ts";

const git = createGitPort();
const fs = createFsPort();

let repo: TestRepo;
let savedEnv: NodeJS.ProcessEnv;

/** Registers a bare repo, kept inside the test's tmp root, as the remote `name`. */
const addRemote = async (name: string): Promise<void> => {
  const remoteDir = join(repo.rootDir, `${name}.git`);
  await repo.git(["init", "--bare", remoteDir]);
  await repo.git(["remote", "add", name, remoteDir]);
};

/**
 * Leaves `branch` only as `refs/remotes/<remote>/<branch>` for each of the
 * (already added) remotes: commits it once, pushes it to each remote, deletes
 * the local branch, then fetches so only the remote-tracking refs are left.
 */
const publishBranch = async (branch: string, remotes: readonly string[]): Promise<void> => {
  await repo.git(["checkout", "-b", branch]);
  await repo.writeFile(`${branch.replaceAll("/", "-")}.txt`, branch);
  await repo.git(["add", "."]);
  await repo.git(["commit", "-m", `add ${branch}`]);
  for (const remote of remotes) {
    // oxlint-disable-next-line no-await-in-loop
    await repo.git(["push", remote, branch]);
  }
  await repo.git(["checkout", "main"]);
  await repo.git(["branch", "-D", branch]);
  for (const remote of remotes) {
    // oxlint-disable-next-line no-await-in-loop
    await repo.git(["fetch", remote]);
  }
};

/** The ambiguous setup: the branch exists on two remotes, neither of which is origin. */
const publishToTwoNonOriginRemotes = async (branch: string): Promise<void> => {
  await addRemote("fork");
  await addRemote("upstream");
  await publishBranch(branch, ["fork", "upstream"]);
};

const jumpCreate = (target: string, track?: string) =>
  jump(git, fs, {
    cwd: repo.repoPath,
    target,
    create: true,
    ...(track === undefined ? {} : { track }),
  });

const currentBranch = async (): Promise<string> => {
  const out = await repo.git(["branch", "--show-current"]);
  return out.trim();
};

const hasLocalBranch = async (branch: string): Promise<boolean> => {
  const out = await repo.git(["branch", "--list", branch]);
  return out.trim().length > 0;
};

/** The branch's upstream ref, or "" when it has none. Throws if the branch does not exist. */
const upstreamOf = async (branch: string): Promise<string> => {
  await repo.git(["rev-parse", "--verify", `refs/heads/${branch}`]);
  const out = await repo.git([
    "for-each-ref",
    "--format=%(upstream:short)",
    `refs/heads/${branch}`,
  ]);
  return out.trim();
};

const worktreeCount = async (): Promise<number> => {
  const out = await repo.git(["worktree", "list", "--porcelain"]);
  return out.split("\n").filter((line) => line.startsWith("worktree ")).length;
};

const expectAmbiguousRemotes = <T>(result: CommandResult<T>): void => {
  expect(result.ok).toBe(false);
  expect(result.exitCode).toBe(2);
  expect(result.errorMessage).toContain("exists on multiple remotes");
  expect(result.errorMessage).toContain("fork");
  expect(result.errorMessage).toContain("upstream");
  expect(result.errorMessage).toContain("Use --track");
};

beforeEach(async () => {
  repo = await createTestRepo();
  savedEnv = { ...process.env };
  Object.assign(process.env, repo.env);
});

afterEach(async () => {
  process.env = savedEnv;
  await repo.cleanup();
});

describe("jump --create — local に無い branch の upstream 選択 (integration)", () => {
  it("branch が origin にだけある場合、upstream が origin/<branch> の状態で作成される", async () => {
    await addRemote("origin");
    await publishBranch("feat/on-origin", ["origin"]);

    const result = await jumpCreate("feat/on-origin");

    expect(result.ok).toBe(true);
    expect(result.data?.created).toBe(true);
    expect(await upstreamOf("feat/on-origin")).toBe("origin/feat/on-origin");
  });

  it("branch が origin と他の remote の両方にある場合、origin が優先されて upstream になる", async () => {
    // "fork" sorts before "origin", so picking the first remote would not pass.
    await addRemote("origin");
    await addRemote("fork");
    await publishBranch("feat/on-both", ["origin", "fork"]);

    const result = await jumpCreate("feat/on-both");

    expect(result.ok).toBe(true);
    expect(result.data?.created).toBe(true);
    expect(await upstreamOf("feat/on-both")).toBe("origin/feat/on-both");
  });

  it("branch が origin 以外の remote 1 つだけにある場合、その remote が upstream になる", async () => {
    await addRemote("upstream");
    await publishBranch("feat/on-upstream", ["upstream"]);

    const result = await jumpCreate("feat/on-upstream");

    expect(result.ok).toBe(true);
    expect(result.data?.created).toBe(true);
    expect(await upstreamOf("feat/on-upstream")).toBe("upstream/feat/on-upstream");
  });

  it("branch が origin 以外の複数 remote にある場合、usage error (exit 2) で worktree は作られない", async () => {
    await publishToTwoNonOriginRemotes("feat/ambiguous");

    const result = await jumpCreate("feat/ambiguous");

    expectAmbiguousRemotes(result);
    expect(await worktreeCount()).toBe(1);
    expect(await hasLocalBranch("feat/ambiguous")).toBe(false);
  });

  it("複数 remote にある branch でも track を明示した場合、その ref が upstream になる", async () => {
    await publishToTwoNonOriginRemotes("feat/ambiguous");

    const result = await jumpCreate("feat/ambiguous", "upstream/feat/ambiguous");

    expect(result.ok).toBe(true);
    expect(result.data?.created).toBe(true);
    expect(await upstreamOf("feat/ambiguous")).toBe("upstream/feat/ambiguous");
  });

  it("branch がどの remote にも local にも無い場合、upstream なしで新規作成される", async () => {
    const result = await jumpCreate("feat/nowhere");

    expect(result.ok).toBe(true);
    expect(result.data?.created).toBe(true);
    expect(await upstreamOf("feat/nowhere")).toBe("");
  });
});

describe("root — local に無い branch の upstream 選択 (integration)", () => {
  it("branch が origin にだけある場合、upstream が origin/<branch> の状態で root が切り替わる", async () => {
    await addRemote("origin");
    await publishBranch("feat/on-origin", ["origin"]);

    const result = await root(git, fs, {
      cwd: repo.repoPath,
      target: "feat/on-origin",
    });

    expect(result.ok).toBe(true);
    expect(result.data?.switched).toBe(true);
    expect(await currentBranch()).toBe("feat/on-origin");
    expect(await upstreamOf("feat/on-origin")).toBe("origin/feat/on-origin");
  });

  it("branch が origin と他の remote の両方にある場合、origin が優先されて upstream になり root が切り替わる", async () => {
    // "fork" sorts before "origin", so picking the first remote would not pass.
    await addRemote("origin");
    await addRemote("fork");
    await publishBranch("feat/on-both", ["origin", "fork"]);

    const result = await root(git, fs, {
      cwd: repo.repoPath,
      target: "feat/on-both",
    });

    expect(result.ok).toBe(true);
    expect(result.data?.switched).toBe(true);
    expect(await currentBranch()).toBe("feat/on-both");
    expect(await upstreamOf("feat/on-both")).toBe("origin/feat/on-both");
  });

  it("branch が origin 以外の remote 1 つだけにある場合、その remote が upstream になり root が切り替わる", async () => {
    await addRemote("upstream");
    await publishBranch("feat/on-upstream", ["upstream"]);

    const result = await root(git, fs, {
      cwd: repo.repoPath,
      target: "feat/on-upstream",
    });

    expect(result.ok).toBe(true);
    expect(result.data?.switched).toBe(true);
    expect(await currentBranch()).toBe("feat/on-upstream");
    expect(await upstreamOf("feat/on-upstream")).toBe("upstream/feat/on-upstream");
  });

  it("branch が origin 以外の複数 remote にある場合、usage error (exit 2) で root は main のまま", async () => {
    await publishToTwoNonOriginRemotes("feat/ambiguous");

    const result = await root(git, fs, {
      cwd: repo.repoPath,
      target: "feat/ambiguous",
    });

    expectAmbiguousRemotes(result);
    expect(await currentBranch()).toBe("main");
    expect(await hasLocalBranch("feat/ambiguous")).toBe(false);
  });

  it("branch がどこにも無い場合、新しい branch を upstream なしで作って root が切り替わる", async () => {
    const result = await root(git, fs, {
      cwd: repo.repoPath,
      target: "feat/brand-new",
    });

    expect(result.ok).toBe(true);
    expect(result.data?.switched).toBe(true);
    expect(await currentBranch()).toBe("feat/brand-new");
    expect(await upstreamOf("feat/brand-new")).toBe("");
  });
});

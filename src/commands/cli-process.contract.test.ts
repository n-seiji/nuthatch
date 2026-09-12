import { execFile as execFileCb } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createTestRepo, type TestRepo } from "../testing/repo.ts";

const execFile = promisify(execFileCb);

/**
 * Contract tests that launch the real `hop` entrypoint (src/cli.ts) as an
 * actual child process — not calling commands/*.ts functions in-process —
 * so a regression that only shows up through the CLI's actual argv
 * parsing / process exit code / stdout-vs-stderr split (as opposed to the
 * CommandResult object commands/*.ts return) gets caught here. Complements,
 * rather than replaces, the in-process integration tests in
 * jump-ls-rm.integration.test.ts and root.integration.test.ts.
 */

const CLI_ENTRYPOINT = join(import.meta.dir, "..", "cli.ts");

interface CliRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const runHop = async (args: readonly string[], cwd: string, env: NodeJS.ProcessEnv) => {
  try {
    const { stdout, stderr } = await execFile("bun", ["run", CLI_ENTRYPOINT, ...args], {
      cwd,
      env,
    });
    return { exitCode: 0, stdout, stderr } satisfies CliRunResult;
  } catch (error) {
    const { code, stdout, stderr } = error as {
      code?: number;
      stdout: string;
      stderr: string;
    };
    return { exitCode: code ?? 1, stdout, stderr } satisfies CliRunResult;
  }
};

let repo: TestRepo;

beforeEach(async () => {
  repo = await createTestRepo();
});

afterEach(async () => {
  await repo.cleanup();
});

describe("hop CLI process contract", () => {
  it("git がロック中の worktree への rm は exit 3 + hop 自身のメッセージで拒否する", async () => {
    await repo.git(["branch", "feat/locked"]);
    const lockedPath = `${repo.rootDir}/agent-worktrees/feat-locked`;
    await repo.git(["worktree", "add", lockedPath, "feat/locked"]);
    await repo.git(["worktree", "lock", lockedPath, "--reason", "in use"]);

    const result = await runHop(["rm", "feat/locked", "--force"], repo.repoPath, repo.env);

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("is locked by git");
    expect(result.stderr).not.toContain("contains modified or untracked files");
  });

  it("中にネストした worktree を含む親への rm は exit 3 + hop 自身のメッセージで拒否する", async () => {
    await repo.git(["branch", "parent"]);
    const parentPath = `${repo.rootDir}/agent-worktrees/parent`;
    await repo.git(["worktree", "add", parentPath, "parent"]);
    const childPath = `${parentPath}/nested-child`;
    await repo.git(["worktree", "add", childPath, "-b", "child"]);
    await repo.git(["worktree", "lock", childPath, "--reason", "in use"]);
    await Bun.write(`${childPath}/untracked.txt`, "dirty");

    const result = await runHop(["rm", "parent", "--force"], repo.repoPath, repo.env);

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("still contains");

    const listing = await execFile("git", ["worktree", "list"], {
      cwd: repo.repoPath,
      env: repo.env,
    });
    expect(listing.stdout).toContain("parent");
    expect(listing.stdout).toContain("child");
  });

  it("`--ext` 付きの外部 worktree 削除は warning: prefix で警告を出す", async () => {
    await repo.git(["branch", "feat/ext"]);
    const externalPath = `${repo.rootDir}/agent-worktrees/feat-ext`;
    await repo.git(["worktree", "add", externalPath, "feat/ext"]);

    const result = await runHop(["rm", "feat/ext", "--ext"], repo.repoPath, repo.env);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("warning: --ext is deprecated");
  });

  it("holder が2つある branch への hop root は exit 3 で拒否する", async () => {
    await repo.git(["branch", "dup"]);
    const h1Path = `${repo.rootDir}/agent-worktrees/dup-1`;
    const h2Path = `${repo.rootDir}/agent-worktrees/dup-2`;
    await repo.git(["worktree", "add", h1Path, "dup"]);
    await repo.git(["worktree", "add", "--force", h2Path, "dup"]);

    const result = await runHop(["root", "dup"], repo.repoPath, repo.env);

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("2 worktrees at once");
  });
});

import { execFile as execFileCb } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

/** Isolated environment so tests never touch the developer's real git config. */
export const isolatedEnv = (home: string): NodeJS.ProcessEnv => ({
  ...process.env,
  HOME: home,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  LC_ALL: "C",
});

export interface TestRepo {
  readonly rootDir: string;
  readonly homeDir: string;
  readonly repoPath: string;
  readonly env: NodeJS.ProcessEnv;
  git(args: readonly string[], cwd?: string): Promise<string>;
  writeFile(relativePath: string, content: string): Promise<void>;
  cleanup(): Promise<void>;
}

/** Creates a real git repo (default branch `main`, one initial commit) in a tmpdir. */
export const createTestRepo = async (): Promise<TestRepo> => {
  const rootDir = await mkdtemp(join(tmpdir(), "nuthatch-test-"));
  const homeDir = join(rootDir, "home");
  const repoPath = join(rootDir, "repo");
  const env = isolatedEnv(homeDir);

  const { mkdir, writeFile: writeFileFs } = await import("node:fs/promises");
  await mkdir(homeDir, { recursive: true });
  await mkdir(repoPath, { recursive: true });

  const git = async (args: readonly string[], cwd: string = repoPath): Promise<string> => {
    const { stdout } = await execFile("git", [...args], { cwd, env });
    return stdout;
  };

  await git(["init", "--initial-branch=main"]);
  await git(["config", "core.hooksPath", "/dev/null"]);
  await writeFileFs(join(repoPath, "README.md"), "# test repo\n");
  await git(["add", "README.md"]);
  await git(["commit", "-m", "initial commit"]);

  return {
    rootDir,
    homeDir,
    repoPath,
    env,
    git,
    async writeFile(relativePath, content) {
      await writeFileFs(join(repoPath, relativePath), content);
    },
    async cleanup() {
      await rm(rootDir, { recursive: true, force: true });
    },
  };
};

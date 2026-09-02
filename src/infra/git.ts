import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { AddWorktreeOptions, GitPort } from "../domain/ports.ts";

const execFile = promisify(execFileCb);

const MAX_BUFFER_BYTES = 64 * 1024 * 1024;

/** Thin wrapper around the git CLI. Always spawns with an argv array — never string concatenation. */
const run = async (cwd: string, args: readonly string[]): Promise<string> => {
  const { stdout } = await execFile("git", [...args], {
    cwd,
    maxBuffer: MAX_BUFFER_BYTES,
  });
  return stdout;
};

export const createGitPort = (): GitPort => ({
  listWorktreesPorcelain(cwd) {
    return run(cwd, ["worktree", "list", "--porcelain", "-z"]);
  },

  async commonDir(cwd) {
    const out = await run(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    return out.trim();
  },

  async isDirty(path) {
    const status = await run(path, ["status", "--porcelain", "--untracked-files=all"]);
    return status.trim().length > 0;
  },

  async addWorktree(cwd, path, branch, options: AddWorktreeOptions) {
    const args = ["worktree", "add"];
    if (options.createBranch) {
      if (options.track !== undefined) {
        args.push("--track");
      }
      args.push("-b", branch);
    }
    args.push(path);
    if (options.track !== undefined) {
      args.push(options.track);
    } else if (!options.createBranch) {
      args.push(branch);
    }
    await run(cwd, args);
  },

  async removeWorktree(cwd, path, force) {
    const args = ["worktree", "remove"];
    if (force) {
      args.push("--force");
    }
    args.push(path);
    await run(cwd, args);
  },

  async aheadBehind(cwd, branch) {
    try {
      const out = await run(cwd, [
        "rev-list",
        "--left-right",
        "--count",
        `${branch}...${branch}@{upstream}`,
      ]);
      const [ahead, behind] = out.trim().split(/\s+/u).map(Number);
      if (ahead === undefined || behind === undefined) {
        return null;
      }
      return { ahead, behind };
    } catch {
      return null;
    }
  },

  async listBranches(cwd) {
    const out = await run(cwd, ["for-each-ref", "--format=%(refname:short)", "refs/heads/"]);
    return out
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  },

  async remotesWithBranch(cwd, branch) {
    const out = await run(cwd, ["for-each-ref", "--format=%(refname)", "refs/remotes/"]);
    const remotes = new Set<string>();
    for (const line of out.split("\n")) {
      const match = /^refs\/remotes\/(?<remote>[^/]+)\/(?<branchName>.+)$/u.exec(line.trim());
      if (match?.groups?.remote !== undefined && match.groups.branchName === branch) {
        remotes.add(match.groups.remote);
      }
    }
    return [...remotes];
  },
});

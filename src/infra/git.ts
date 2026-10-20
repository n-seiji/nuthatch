import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { isDirtyFromStatus } from "../domain/dirty.ts";
import type { AddWorktreeOptions, GitPort, SwitchBranchOptions } from "../domain/ports.ts";
import { parseUpstreamStates, UPSTREAM_FORMAT, type UpstreamState } from "../domain/upstream.ts";
import { createGitExecutableResolver } from "./git-executable.ts";

const execFile = promisify(execFileCb);

/**
 * Spawns git by absolute path, resolved once per process: handing the bare
 * name "git" can fail in a compiled Bun binary with
 * `ENOENT ... posix_spawn 'git'`. See git-executable.ts.
 */
const gitExecutable = createGitExecutableResolver(process.env);

const MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const GIT_ANCESTOR_EXIT_CODE = 1;

/** Thin wrapper around the git CLI. Always spawns with an argv array — never string concatenation. */
const run = async (cwd: string, args: readonly string[]): Promise<string> => {
  const { stdout } = await execFile(await gitExecutable(), [...args], {
    cwd,
    maxBuffer: MAX_BUFFER_BYTES,
  });
  return stdout;
};

/** True only for a clean, expected non-zero exit (e.g. `--is-ancestor` reporting "no"). */
const failedWithExitCode = (error: unknown, code: number): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: unknown }).code === code;

/** Parses `refs/remotes/<remote>/<branchName>` lines from `for-each-ref`. */
const parseRemoteRefs = (out: string): { remote: string; branchName: string }[] => {
  const parsed: { remote: string; branchName: string }[] = [];
  for (const line of out.split("\n")) {
    const match = /^refs\/remotes\/(?<remote>[^/]+)\/(?<branchName>.+)$/u.exec(line.trim());
    if (match?.groups?.remote !== undefined && match.groups.branchName !== undefined) {
      parsed.push({
        remote: match.groups.remote,
        branchName: match.groups.branchName,
      });
    }
  }
  return parsed;
};

const createWorktreeMethods = () => ({
  listWorktreesPorcelain(cwd: string) {
    return run(cwd, ["worktree", "list", "--porcelain", "-z"]);
  },

  async commonDir(cwd: string) {
    const out = await run(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    return out.trim();
  },

  async isDirty(path: string, otherWorktreePaths: readonly string[]) {
    // -z is required, not just convenient: see dirty.ts's parseStatusPaths
    // Doc comment for why the non -z, quoted form can't be parsed reliably.
    const status = await run(path, ["status", "--porcelain", "-z", "--untracked-files=all"]);
    return isDirtyFromStatus(status, path, otherWorktreePaths);
  },

  async addWorktree(cwd: string, path: string, branch: string, options: AddWorktreeOptions) {
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

  async removeWorktree(cwd: string, path: string, force: boolean) {
    const args = ["worktree", "remove"];
    if (force) {
      args.push("--force");
    }
    args.push(path);
    await run(cwd, args);
  },

  async upstreamStates(cwd: string) {
    try {
      const out = await run(cwd, ["for-each-ref", `--format=${UPSTREAM_FORMAT}`, "refs/heads/"]);
      return parseUpstreamStates(out);
    } catch {
      return new Map<string, UpstreamState>();
    }
  },
});

const createBranchMethods = () => ({
  async listBranches(cwd: string) {
    const out = await run(cwd, ["for-each-ref", "--format=%(refname:short)", "refs/heads/"]);
    return out
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  },

  async remotesWithBranch(cwd: string, branch: string) {
    const out = await run(cwd, ["for-each-ref", "--format=%(refname)", "refs/remotes/"]);
    const remotes = new Set<string>();
    for (const { remote, branchName } of parseRemoteRefs(out)) {
      if (branchName === branch) {
        remotes.add(remote);
      }
    }
    return [...remotes];
  },

  async listRemoteBranches(cwd: string) {
    const out = await run(cwd, ["for-each-ref", "--format=%(refname)", "refs/remotes/"]);
    const branches = new Set<string>();
    for (const { branchName } of parseRemoteRefs(out)) {
      // "HEAD" here is the remote's symbolic default-branch pointer (e.g.
      // Refs/remotes/origin/HEAD), not an actual branch — always skip it.
      if (branchName !== "HEAD") {
        branches.add(branchName);
      }
    }
    return [...branches];
  },

  async switchBranch(cwd: string, ref: string, options: SwitchBranchOptions = {}) {
    const args = ["switch"];
    if (options.createBranch) {
      if (options.track !== undefined) {
        args.push("--track");
      }
      args.push("-c", ref);
      if (options.track !== undefined) {
        args.push(options.track);
      }
    } else {
      args.push("--end-of-options", ref);
    }
    await run(cwd, args);
  },

  async deleteBranch(cwd: string, branch: string) {
    await run(cwd, ["branch", "-D", "--end-of-options", branch]);
  },

  async detachHead(cwd: string) {
    await run(cwd, ["switch", "--detach", "HEAD"]);
  },
});

const createGarbagePolicyMethods = () => ({
  async resolveDefaultBranchRef(cwd: string) {
    try {
      const out = await run(cwd, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
      const ref = out.trim();
      if (ref.length > 0) {
        return ref;
      }
    } catch {
      // No origin/HEAD symref (e.g. no "origin" remote, or it was never set).
    }
    try {
      await run(cwd, ["rev-parse", "--verify", "--quiet", "main"]);
      return "main";
    } catch {
      // No local "main"; fall through to "master".
    }
    try {
      await run(cwd, ["rev-parse", "--verify", "--quiet", "master"]);
      return "master";
    } catch {
      return null;
    }
  },

  async isAncestor(cwd: string, branch: string, ref: string) {
    try {
      await run(cwd, ["merge-base", "--is-ancestor", "--end-of-options", branch, ref]);
      return true;
    } catch (error) {
      if (failedWithExitCode(error, GIT_ANCESTOR_EXIT_CODE)) {
        return false;
      }
      return "unknown";
    }
  },

  async hasEquivalentCommits(cwd: string, branch: string, ref: string) {
    try {
      const out = await run(cwd, ["cherry", "--end-of-options", ref, branch]);
      // Each line is "+ <sha>" when no equivalent patch exists on ref, or
      // "- <sha>" when an equivalent patch is already represented there.
      // This can match one-to-one cherry-picks and simple squash merges, but
      // A multi-commit squash may not match each original patch. Any "+" line
      // Is therefore treated as unsafe.
      return !out.split("\n").some((line) => line.startsWith("+"));
    } catch {
      return "unknown";
    }
  },
});

export const createGitPort = (): GitPort => ({
  ...createWorktreeMethods(),
  ...createBranchMethods(),
  ...createGarbagePolicyMethods(),
});

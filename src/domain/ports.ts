/**
 * Interfaces that domain/command logic depends on but does not implement.
 * Concrete implementations live in infra/ and are injected by commands.
 */

import type { CommandArgv, InstallFacts } from "./install-method.ts";
import type { McpFileClient } from "./mcp-install.ts";
import type { StatusCommit } from "./schema.ts";

export interface GitPort {
  /** Runs `git worktree list --porcelain -z` and returns raw stdout. */
  listWorktreesPorcelain: (cwd: string) => Promise<string>;
  /** Absolute path to the git common dir (shared across worktrees). */
  commonDir: (cwd: string) => Promise<string>;
  /**
   * True if the worktree at `path` has uncommitted changes or untracked
   * files. `otherWorktreePaths` (other registered worktrees' realpath'd
   * paths) are excluded from the check: a worktree nested inside `path`
   * (e.g. Claude Code's EnterWorktree under `.claude/worktrees/`) must not
   * make `path` itself look dirty.
   */
  isDirty: (path: string, otherWorktreePaths: readonly string[]) => Promise<boolean>;
  /** Creates a new worktree at `path` for `branch`, creating the branch if needed. */
  addWorktree: (
    cwd: string,
    path: string,
    branch: string,
    options: AddWorktreeOptions,
  ) => Promise<void>;
  /** Raw `git status --porcelain -z --untracked-files=all` output for the worktree at `path`. */
  statusPorcelain: (path: string) => Promise<string>;
  /** The commit `rev` points at, or null if it cannot be read (e.g. an unborn branch). */
  commitInfo: (cwd: string, rev: string) => Promise<StatusCommit | null>;
  /** Short name of `branch`'s upstream (e.g. `origin/feat/x`), or null if it has none. */
  upstreamOf: (cwd: string, branch: string) => Promise<string | null>;
  /** Removes a worktree. */
  removeWorktree: (cwd: string, path: string, force: boolean) => Promise<void>;
  /** Ahead/behind counts of `branch` versus its upstream, if any. */
  aheadBehind: (cwd: string, branch: string) => Promise<{ ahead: number; behind: number } | null>;
  /** Lists local branch names. */
  listBranches: (cwd: string) => Promise<string[]>;
  /** Lists remotes that have a branch with this name, e.g. ["origin"]. */
  remotesWithBranch: (cwd: string, branch: string) => Promise<string[]>;
  /** Lists unique branch names across all remotes (remote prefix stripped, deduped, no HEAD symref). */
  listRemoteBranches: (cwd: string) => Promise<string[]>;
  /** Switches the worktree at `cwd` to `ref` (a branch name or "-" for the previous branch). */
  switchBranch: (cwd: string, ref: string, options?: SwitchBranchOptions) => Promise<void>;
  /** Detaches HEAD at `cwd` (`git switch --detach`), freeing up whatever branch it held. */
  detachHead: (cwd: string) => Promise<void>;
  /** The repo's default branch ref: origin/HEAD if set, else local main/master. Null if none found. */
  resolveDefaultBranchRef: (cwd: string) => Promise<string | null>;
  /** Whether every commit on `branch` is also reachable from `ref` ("unknown" if undeterminable). */
  isAncestor: (cwd: string, branch: string, ref: string) => Promise<boolean | "unknown">;
  /**
   * Whether every commit on `branch` is either an ancestor of `ref` or has an
   * equivalent patch already applied on `ref` ("unknown" if undeterminable).
   * Unlike `isAncestor`, this also recognizes squash-merged branches, whose
   * commits are never literal ancestors of the branch they were merged into.
   */
  hasEquivalentCommits: (cwd: string, branch: string, ref: string) => Promise<boolean | "unknown">;
  /** True if `branch`'s upstream is marked `[gone]` (its remote-tracking branch was deleted). */
  isUpstreamGone: (cwd: string, branch: string) => Promise<boolean>;
  /** Deletes a local branch. Callers must have already established it is safe to delete. */
  deleteBranch: (cwd: string, branch: string) => Promise<void>;
}

export interface AddWorktreeOptions {
  readonly createBranch: boolean;
  readonly track?: string;
}

export interface SwitchBranchOptions {
  readonly createBranch?: boolean;
  readonly track?: string;
}

export interface FsPort {
  exists: (path: string) => Promise<boolean>;
  realpath: (path: string) => Promise<string>;
  mkdir: (path: string) => Promise<void>;
  listDirNames: (path: string) => Promise<string[]>;
}

export interface TermPort {
  isTTY: () => boolean;
  logStderr: (message: string) => void;
  /** Prompts on stderr/stdin and resolves to whether the user confirmed. Only call when isTTY(). */
  confirm: (message: string) => Promise<boolean>;
}

/**
 * Everything `hop --update` needs from outside the process: the network, the
 * binary on disk, and package managers. Every network address is fixed (see
 * domain/self-update.ts), and every method may reject — the command turns a
 * rejection into a failed result.
 */
export interface SelfUpdatePort {
  /** How this hop process was installed (see domain/install-method.ts). */
  installFacts: () => Promise<InstallFacts>;
  /** Version of the latest GitHub release: the tag without its leading `v`. */
  latestGithubVersion: () => Promise<string>;
  /** Version npm's `latest` dist-tag points at (the one `npm i -g` would get). */
  latestNpmVersion: () => Promise<string>;
  /** Bytes of release asset `assetName` of tag `v<version>`. */
  downloadReleaseAsset: (version: string, assetName: string) => Promise<Uint8Array>;
  /** Text of a small release asset of tag `v<version>`, e.g. a `.sha256` file. */
  downloadReleaseText: (version: string, assetName: string) => Promise<string>;
  /** Lowercase hex SHA-256 of `bytes`. */
  sha256Hex: (bytes: Uint8Array) => string;
  /**
   * Resolves when files can be created in `dir`; rejects with the underlying
   * fs error (e.g. `code: "EACCES"` or `"EROFS"`) when they cannot. A cheap
   * early answer, not a promise: `replaceExecutable` can still fail.
   */
  assertWritableDir: (dir: string) => Promise<void>;
  /**
   * Atomically replaces the executable at `path` (through a symlink, the
   * link's target) with `bytes`, mode 0755. Rejects with the underlying fs
   * error (e.g. `code: "EACCES"`) when it cannot, leaving nothing behind.
   */
  replaceExecutable: (path: string, bytes: Uint8Array) => Promise<void>;
  /**
   * Absolute path of the executable `name`: in `preferredDir` if it is there
   * (null: no preference), else in the first absolute PATH entry that has it;
   * null if it is in neither.
   */
  resolveExecutable: (name: string, preferredDir: string | null) => Promise<string | null>;
  /**
   * Runs `argv` (a program by absolute path, then its arguments) in the
   * user's home directory — never the directory hop was started in, whose own
   * project config must not steer a package manager's update — with stdin
   * inherited and both of the child's output streams sent to hop's stderr,
   * and resolves to its exit code. Rejects if the process cannot be started
   * or is killed by a signal (the message names the signal).
   */
  runCommand: (argv: CommandArgv) => Promise<number>;
}

/** What `hop mcp install` / `hop mcp config` need from outside the process. */
export interface McpInstallPort {
  /**
   * The user-level config file of a client configured by file: cursor's
   * `~/.cursor/mcp.json`; opencode's `opencode.json` in
   * `$XDG_CONFIG_HOME/opencode` (default `~/.config/opencode`), or its
   * `opencode.jsonc` when only that exists.
   */
  configPath: (client: McpFileClient) => Promise<string>;
  /** The file's text, or null if it does not exist; rejects on any other read error. */
  readTextFile: (path: string) => Promise<string | null>;
  /** Creates the parent directory if needed, then atomically replaces the file with `text`. */
  writeTextFile: (path: string, text: string) => Promise<void>;
  /** Absolute path of the executable `name` on PATH, or null. */
  resolveExecutable: (name: string) => Promise<string | null>;
  /**
   * Runs `argv` (a program by absolute path, then its arguments) with its
   * output on hop's stderr, resolving to its exit code; rejects if it cannot
   * be started or is killed by a signal.
   */
  runCommand: (argv: CommandArgv) => Promise<number>;
}

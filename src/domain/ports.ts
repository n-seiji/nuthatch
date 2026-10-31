/**
 * Interfaces that domain/command logic depends on but does not implement.
 * Concrete implementations live in infra/ and are injected by commands.
 */

import type { InstallFacts } from "./install-method.ts";
import type { UpstreamState } from "./upstream.ts";

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
  /** Removes a worktree. */
  removeWorktree: (cwd: string, path: string, force: boolean) => Promise<void>;
  /**
   * Every local branch's upstream state, keyed by short branch name, from a
   * single git call. Never rejects: if git can't answer, the map is empty,
   * which reads as "no upstream" for every branch.
   */
  upstreamStates: (cwd: string) => Promise<ReadonlyMap<string, UpstreamState>>;
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
 * Everything `hop --update` needs from outside the process: the network and
 * the binary on disk. Every network address is fixed (see
 * domain/self-update.ts), and every method may reject — the command turns a
 * rejection into a failed result.
 */
export interface SelfUpdatePort {
  /** How this hop process was installed (see domain/install-method.ts). */
  installFacts: () => Promise<InstallFacts>;
  /** Version of the latest GitHub release: the tag without its leading `v`. */
  latestGithubVersion: () => Promise<string>;
  /** Bytes of release asset `assetName` of tag `v<version>`. */
  downloadReleaseAsset: (version: string, assetName: string) => Promise<Uint8Array>;
  /** Text of a small release asset of tag `v<version>`, e.g. a `.sha256` file. */
  downloadReleaseText: (version: string, assetName: string) => Promise<string>;
  /** Lowercase hex SHA-256 of `bytes`. */
  sha256Hex: (bytes: Uint8Array) => string;
  /**
   * Resolves when files can be created in `dir`; otherwise rejects with the
   * fs error (e.g. `EACCES`, `EROFS`). Advisory: `replaceExecutable` can still fail.
   */
  assertWritableDir: (dir: string) => Promise<void>;
  /**
   * Atomically replaces the executable at `path` (the link's target, for a
   * symlink) with `bytes`, mode 0755. Rejects with the fs error and leaves
   * nothing behind on failure.
   */
  replaceExecutable: (path: string, bytes: Uint8Array) => Promise<void>;
}

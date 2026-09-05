/**
 * Interfaces that domain/command logic depends on but does not implement.
 * Concrete implementations live in infra/ and are injected by commands.
 */

export interface GitPort {
  /** Runs `git worktree list --porcelain -z` and returns raw stdout. */
  listWorktreesPorcelain: (cwd: string) => Promise<string>;
  /** Absolute path to the git common dir (shared across worktrees). */
  commonDir: (cwd: string) => Promise<string>;
  /** True if the worktree at `path` has uncommitted changes or untracked files. */
  isDirty: (path: string) => Promise<boolean>;
  /** Creates a new worktree at `path` for `branch`, creating the branch if needed. */
  addWorktree: (
    cwd: string,
    path: string,
    branch: string,
    options: AddWorktreeOptions,
  ) => Promise<void>;
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

export interface WorktreeQuery {
  git: GitPort;
  fs: FsPort;
}

export type { Worktree } from "./model.ts";

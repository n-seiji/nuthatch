/**
 * Interfaces that domain/command logic depends on but does not implement.
 * Concrete implementations live in infra/ and are injected by commands.
 */
import type { Worktree } from "./model.ts";

export interface GitPort {
  /** Runs `git worktree list --porcelain -z` and returns raw stdout. */
  listWorktreesPorcelain(cwd: string): Promise<string>;
  /** Absolute path to the git common dir (shared across worktrees). */
  commonDir(cwd: string): Promise<string>;
  /** True if the worktree at `path` has uncommitted changes or untracked files. */
  isDirty(path: string): Promise<boolean>;
  /** Creates a new worktree at `path` for `branch`, creating the branch if needed. */
  addWorktree(
    cwd: string,
    path: string,
    branch: string,
    options: AddWorktreeOptions,
  ): Promise<void>;
  /** Removes a worktree. */
  removeWorktree(cwd: string, path: string, force: boolean): Promise<void>;
  /** Ahead/behind counts of `branch` versus its upstream, if any. */
  aheadBehind(cwd: string, branch: string): Promise<{ ahead: number; behind: number } | null>;
  /** Lists local branch names. */
  listBranches(cwd: string): Promise<string[]>;
  /** Lists remotes that have a branch with this name, e.g. ["origin"]. */
  remotesWithBranch(cwd: string, branch: string): Promise<string[]>;
}

export interface AddWorktreeOptions {
  readonly createBranch: boolean;
  readonly track?: string;
}

export interface FsPort {
  exists(path: string): Promise<boolean>;
  realpath(path: string): Promise<string>;
  mkdir(path: string): Promise<void>;
  listDirNames(path: string): Promise<string[]>;
}

export interface TermPort {
  isTTY(): boolean;
  logStderr(message: string): void;
}

export interface WorktreeQuery {
  git: GitPort;
  fs: FsPort;
}

export type { Worktree };

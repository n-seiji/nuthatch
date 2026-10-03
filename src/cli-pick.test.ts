import { rm as removeDirectory } from "node:fs/promises";
import { describe, expect, it, spyOn } from "bun:test";
import { jump } from "./commands/jump.ts";
import type { PickCandidate } from "./domain/candidates.ts";
import { createFsPort } from "./infra/fs.ts";
import { createGitPort } from "./infra/git.ts";
import { createTestRepo, type TestRepo } from "./testing/repo.ts";
import {
  createPickerCallbacks,
  loadPickCandidates,
  renderSwitchRootOutcome,
  type SwitchRootOutcome,
} from "./cli-pick.ts";

describe("renderSwitchRootOutcome", () => {
  it("--json: detachedHolder と warnings を envelope に含める", () => {
    const stdout = spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const outcome: SwitchRootOutcome = {
        branch: "feat/held",
        detachedHolder: "/repo/held",
        warnings: ["Put /repo/held into detached HEAD"],
      };
      renderSwitchRootOutcome("/repo", outcome, true);

      expect(stdout).toHaveBeenCalledTimes(1);
      const written = stdout.mock.calls[0]?.[0] as string;
      const envelope = JSON.parse(written) as {
        data: {
          branch: string;
          switched: boolean;
          detachedHolder: string | null;
        };
        warnings: readonly string[];
      };
      expect(envelope.data).toEqual({
        branch: "feat/held",
        switched: true,
        detachedHolder: "/repo/held",
      });
      expect(envelope.warnings).toEqual(["Put /repo/held into detached HEAD"]);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });

  it("非 --json: path を stdout に、warnings を stderr に出す", () => {
    const stdout = spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const outcome: SwitchRootOutcome = {
        branch: "feat/held",
        detachedHolder: "/repo/held",
        warnings: ["Put /repo/held into detached HEAD"],
      };
      renderSwitchRootOutcome("/repo", outcome, false);

      expect(stdout).toHaveBeenCalledWith("/repo\n");
      expect(stderr).toHaveBeenCalledWith("warning: Put /repo/held into detached HEAD\n");
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });

  it("holder を detach しなかった場合は detachedHolder が null で warnings も空", () => {
    const stdout = spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const outcome: SwitchRootOutcome = {
        branch: "main",
        detachedHolder: null,
        warnings: [],
      };
      renderSwitchRootOutcome("/repo", outcome, true);

      const written = stdout.mock.calls[0]?.[0] as string;
      const envelope = JSON.parse(written) as {
        data: { detachedHolder: string | null };
        warnings: readonly string[];
      };
      expect(envelope.data.detachedHolder).toBeNull();
      expect(envelope.warnings).toEqual([]);
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });
});

describe("createPickerCallbacks — fresh external-holder safety", () => {
  it("picker 表示後に external holder が作られても未確認のまま detach しない", async () => {
    const repo = await createTestRepo();
    const cwd = spyOn(process, "cwd").mockReturnValue(repo.repoPath);
    try {
      const staleCandidate = {
        kind: "creatable" as const,
        branch: "feat/raced-external",
        source: "local" as const,
      };
      await repo.git(["branch", staleCandidate.branch]);
      const externalPath = `${repo.rootDir}/agent-worktrees/raced-external`;
      await repo.git(["worktree", "add", externalPath, staleCandidate.branch]);

      const callbacks = createPickerCallbacks(createGitPort(), createFsPort(), false, () => {});
      const result = await callbacks.switchRootHere(staleCandidate);

      expect(result.ok).toBe(false);
      expect(result.message).toContain("confirmation");
      const rootBranch = await repo.git(["branch", "--show-current"]);
      const holderBranch = await repo.git(["branch", "--show-current"], externalPath);
      expect(rootBranch.trim()).toBe("main");
      expect(holderBranch.trim()).toBe(staleCandidate.branch);
    } finally {
      cwd.mockRestore();
      await repo.cleanup();
    }
  });
});

const git = createGitPort();
const fs = createFsPort();
const BRANCH = "feat/picker-delete";

/** Runs `run` against a real repo that `process.cwd()` points at, with git isolated from the developer's config. */
const inPickerRepo = async (run: (repo: TestRepo) => Promise<void>): Promise<void> => {
  const repo = await createTestRepo();
  const savedEnv = { ...process.env };
  Object.assign(process.env, repo.env);
  const cwd = spyOn(process, "cwd").mockReturnValue(repo.repoPath);
  try {
    await run(repo);
  } finally {
    cwd.mockRestore();
    process.env = savedEnv;
    await repo.cleanup();
  }
};

const createManagedWorktree = async (): Promise<string> => {
  const created = await jump(git, fs, {
    cwd: process.cwd(),
    target: BRANCH,
    create: true,
  });
  if (created.path === undefined) {
    throw new Error("expected jump to report a path");
  }
  return created.path;
};

/** BRANCH's row of the candidate list, loaded the way the picker loads it when it opens. */
const loadCandidate = async (): Promise<PickCandidate> => {
  const candidates = await loadPickCandidates(git, fs, false);
  const candidate = candidates?.find(
    (entry) => entry.kind === "worktree" && entry.worktree.branch === BRANCH,
  );
  if (candidate === undefined) {
    throw new Error("expected the picker to list the worktree");
  }
  return candidate;
};

describe("createPickerCallbacks — prunable delete safety", () => {
  it("picker 表示後に worktree が prunable になった場合、未確認のまま登録を削除せず拒否する", () =>
    inPickerRepo(async (repo) => {
      const path = await createManagedWorktree();
      const staleCandidate = await loadCandidate();
      expect(staleCandidate).toMatchObject({ kind: "worktree", worktree: { prunable: false } });
      await removeDirectory(path, { recursive: true, force: true });

      const callbacks = createPickerCallbacks(git, fs, false, () => {});
      const result = await callbacks.deleteWorktree(staleCandidate);

      expect(result.ok).toBe(false);
      expect(result.message).toContain("changed before removal");
      expect(result.message).toContain("git now reports it prunable");
      expect(await repo.git(["worktree", "list", "--porcelain"])).toContain(path);
    }));

  it("picker 表示時点で prunable だった worktree の場合、y/N 確認済みとして登録を削除する", () =>
    inPickerRepo(async (repo) => {
      const path = await createManagedWorktree();
      await removeDirectory(path, { recursive: true, force: true });
      const candidate = await loadCandidate();
      expect(candidate).toMatchObject({ kind: "worktree", worktree: { prunable: true } });

      const callbacks = createPickerCallbacks(git, fs, false, () => {});
      const result = await callbacks.deleteWorktree(candidate);

      expect(result.ok).toBe(true);
      expect(await repo.git(["worktree", "list", "--porcelain"])).not.toContain(path);
    }));

  it("prunable でない worktree の場合、prunable の未確認拒否に巻き込まれず通常どおり削除する", () =>
    inPickerRepo(async (repo) => {
      const path = await createManagedWorktree();
      const candidate = await loadCandidate();
      expect(candidate).toMatchObject({ kind: "worktree", worktree: { prunable: false } });

      const callbacks = createPickerCallbacks(git, fs, false, () => {});
      const result = await callbacks.deleteWorktree(candidate);

      expect(result.ok).toBe(true);
      expect(await fs.exists(path)).toBe(false);
      expect(await repo.git(["worktree", "list", "--porcelain"])).not.toContain(path);
    }));
});

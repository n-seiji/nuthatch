import { execFileSync, spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { parse } from "valibot";
import { createFsPort } from "./infra/fs.ts";
import { createGitPort } from "./infra/git.ts";
import {
  JumpEnvelopeSchema,
  LsEnvelopeSchema,
  PickEnvelopeSchema,
  RmEnvelopeSchema,
} from "./domain/schema.ts";
import { pick } from "./commands/pick.ts";
import { type TestRepo, createTestRepo } from "./testing/repo.ts";

const CLI_ENTRY = new URL("cli.ts", import.meta.url).pathname;

let repo: TestRepo;
const git = createGitPort();
const fs = createFsPort();

beforeEach(async () => {
  repo = await createTestRepo();
});

afterEach(async () => {
  await repo.cleanup();
});

const runHop = (args: readonly string[]): unknown => {
  const stdout = execFileSync("bun", ["run", CLI_ENTRY, ...args], {
    cwd: repo.repoPath,
    env: repo.env,
    encoding: "utf8",
  });
  return JSON.parse(stdout);
};

/**
 * Contract tests: actual `hop --json` stdout, parsed with valibot against the
 * same schemas commands/render.ts are typed from. This is what would fail if
 * a command's shape ever drifted from the documented JSON envelope.
 */
describe("hop --json contract", () => {
  it("ls --json は LsEnvelopeSchema を満たす", () => {
    const output = runHop(["ls", "--json"]);
    expect(() => parse(LsEnvelopeSchema, output)).not.toThrow();
    const parsed = parse(LsEnvelopeSchema, output);
    expect(parsed.command).toBe("ls");
    expect(parsed.data?.some((wt) => wt.kind === "root")).toBe(true);
  });

  it("jump (create) --json は JumpEnvelopeSchema を満たす", () => {
    const output = runHop(["feat/contract", "--create", "--json"]);
    const parsed = parse(JumpEnvelopeSchema, output);
    expect(parsed.command).toBe("jump");
    expect(parsed.data).toEqual({ branch: "feat/contract", created: true });
  });

  it("rm --json は RmEnvelopeSchema を満たす", () => {
    runHop(["feat/to-remove", "--create", "--json"]);
    const output = runHop(["rm", "feat/to-remove", "--json"]);
    const parsed = parse(RmEnvelopeSchema, output);
    expect(parsed.command).toBe("rm");
    expect(parsed.data?.branch).toBe("feat/to-remove");
  });

  it("pick の候補データは PickEnvelopeSchema を満たす", async () => {
    const result = await pick(git, fs, { cwd: repo.repoPath });
    const output = {
      schemaVersion: 1,
      command: "pick",
      data: result.data,
      warnings: result.warnings ?? [],
    };
    const parsed = parse(PickEnvelopeSchema, output);
    expect(parsed.command).toBe("pick");
    expect(parsed.data?.candidates.some((candidate) => candidate.kind === "worktree")).toBe(true);
  });
});

describe("bare `hop` (no target)", () => {
  it("非 TTY では ls 相当の一覧を返す (picker を起動しない)", () => {
    // ExecFileSync always pipes stdout/stderr, so this runs with isTTY()
    // False end to end — if the picker path were taken instead, the
    // Terminal session would try to read from a non-interactive stdin and
    // This would hang or error instead of returning promptly.
    const output = runHop(["--json"]);
    const parsed = parse(LsEnvelopeSchema, output);
    expect(parsed.command).toBe("ls");
  });
});

describe("hop root <branch> → hop root - (real CLI, holder swap)", () => {
  // Regression test for a bug citty-level `root -` parsing had: citty's
  // Positional-arg parser silently drops a bare "-" token, so calling
  // `root()` directly (as root.integration.test.ts does) never exercises the
  // Actual argv → citty → root() path and can't catch this. Only spawning
  // The real CLI binary reproduces it.
  it("holder swap 後の `hop root -` は root の branch を元に戻す", () => {
    execFileSync("git", ["branch", "swap-clean"], {
      cwd: repo.repoPath,
      env: repo.env,
    });
    execFileSync("git", ["worktree", "add", ".claude/worktrees/swap-clean", "swap-clean"], {
      cwd: repo.repoPath,
      env: repo.env,
    });

    const swapped = runHop(["root", "swap-clean", "--json"]) as {
      data: { branch: string | null };
    };
    expect(swapped.data.branch).toBe("swap-clean");
    const branchAfterSwap = execFileSync("git", ["branch", "--show-current"], {
      cwd: repo.repoPath,
      env: repo.env,
      encoding: "utf8",
    }).trim();
    expect(branchAfterSwap).toBe("swap-clean");

    const back = runHop(["root", "-", "--json"]) as {
      data: { branch: string | null };
    };
    // The resolved branch name after switching back, not null — the caller
    // Has no other way to learn what "-" actually landed on.
    expect(back.data.branch).toBe("main");
    const branchAfterBack = execFileSync("git", ["branch", "--show-current"], {
      cwd: repo.repoPath,
      env: repo.env,
      encoding: "utf8",
    }).trim();
    expect(branchAfterBack).toBe("main");
  });

  it("フラグが '-' より前でも `hop root --json -` は元の branch に戻す", () => {
    execFileSync("git", ["branch", "plain"], {
      cwd: repo.repoPath,
      env: repo.env,
    });
    execFileSync("bun", ["run", CLI_ENTRY, "root", "plain"], {
      cwd: repo.repoPath,
      env: repo.env,
    });
    const branchAfterSwitch = execFileSync("git", ["branch", "--show-current"], {
      cwd: repo.repoPath,
      env: repo.env,
      encoding: "utf8",
    }).trim();
    expect(branchAfterSwitch).toBe("plain");

    // Regression test: rewriteRootPreviousToken used to only look at
    // Args[0], so a flag placed before "-" (like --json here) shadowed it
    // And citty silently dropped the "-" token entirely.
    const back = runHop(["root", "--json", "-"]) as {
      data: { branch: string | null; switched: boolean };
    };
    expect(back.data.switched).toBe(true);
    expect(back.data.branch).toBe("main");
    const branchAfterBack = execFileSync("git", ["branch", "--show-current"], {
      cwd: repo.repoPath,
      env: repo.env,
      encoding: "utf8",
    }).trim();
    expect(branchAfterBack).toBe("main");
  });
});

describe("hop --help / -h / help", () => {
  const runHelp = (args: readonly string[]) =>
    spawnSync("bun", ["run", CLI_ENTRY, ...args], {
      cwd: repo.repoPath,
      env: repo.env,
      encoding: "utf8",
    });

  it("--help は stderr に usage を出し、stdout は空、exit code は 0", () => {
    const result = runHelp(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Usage: hop");
    expect(result.stderr).toContain("hop ls [--json]");
  });

  it("-h と 予約語 help も usage を出して exit 0 になる", () => {
    const short = runHelp(["-h"]);
    expect(short.status).toBe(0);
    expect(short.stderr).toContain("Usage: hop");

    const word = runHelp(["help"]);
    expect(word.status).toBe(0);
    expect(word.stderr).toContain("Usage: hop");
  });

  it("hop -- help は help を予約せず branch help への jump として扱う", () => {
    // `bun run <file> -- ...` treats its own first "--" as the separator
    // Between bun's flags and the script's argv, so a second "--" is needed
    // Here for hop's own `--` to actually reach process.argv.
    const output = runHop(["--", "--", "help", "--create", "--json"]);
    const parsed = parse(JumpEnvelopeSchema, output);
    expect(parsed.command).toBe("jump");
    expect(parsed.data).toEqual({ branch: "help", created: true });
  });
});

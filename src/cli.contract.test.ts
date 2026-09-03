import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
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
    // False end to end — if the picker path were taken instead, ink would
    // Try to read from a non-interactive stdin and this would hang or
    // Error instead of returning promptly.
    const output = runHop(["--json"]);
    const parsed = parse(LsEnvelopeSchema, output);
    expect(parsed.command).toBe("ls");
  });

  it("cli.ts は ink の picker を動的 import のみで読み込む (静的 import しない)", async () => {
    // Guarantees the "non-TTY never touches ink" contract can't regress
    // Silently: if someone changes `await import("./ui/picker.tsx")` to a
    // Static top-level import, ink/react would load unconditionally on
    // Every invocation, including the fast non-interactive JSON paths above.
    const source = await readFile(new URL("cli.ts", import.meta.url), "utf8");
    expect(source).toContain('await import("./ui/picker.tsx")');
    expect(source).not.toMatch(/^import .* from ["']\.\/ui\/picker\.tsx["'];?$/mu);
  });
});

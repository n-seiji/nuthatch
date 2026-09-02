import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { parse } from "valibot";
import { JumpEnvelopeSchema, LsEnvelopeSchema, RmEnvelopeSchema } from "./domain/schema.ts";
import { type TestRepo, createTestRepo } from "./testing/repo.ts";

const CLI_ENTRY = new URL("cli.ts", import.meta.url).pathname;

let repo: TestRepo;

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
});

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { parse } from "valibot";
import packageJson from "../package.json" with { type: "json" };
import { EXIT_GENERAL_ERROR, EXIT_SUCCESS, EXIT_USAGE_ERROR } from "./domain/result.ts";
import { UpdateEnvelopeSchema } from "./domain/schema.ts";
import { runHop } from "./testing/cli.ts";
import { createTestRepo, type TestRepo } from "./testing/repo.ts";

/**
 * Process-level contract for `hop --version` and `hop --update`. Every run
 * here starts from this source checkout (`bun run src/cli.ts`), which
 * `hop --update` must refuse as a "source checkout" — the install method is
 * decided before any network request, so these tests need no network and can
 * never change anything. Only `--check` and malformed invocations are run:
 * nothing here would be safe to run for real.
 */

let repo: TestRepo;

beforeAll(async () => {
  repo = await createTestRepo();
});

afterAll(async () => {
  await repo.cleanup();
});

const hop = (args: readonly string[]) => runHop(args, repo.repoPath, repo.env);

describe("hop --version", () => {
  it("package.json の version を stdout に 1 行だけ出し、exit 0 になる", async () => {
    const result = await hop(["--version"]);

    expect(result).toEqual({
      exitCode: EXIT_SUCCESS,
      stdout: `${packageJson.version}\n`,
      stderr: "",
    });
  });
});

describe("hop --update (このソースチェックアウトから)", () => {
  it("--update --check はソースチェックアウトとして拒否し、exit 1、stdout は空のまま", async () => {
    const result = await hop(["--update", "--check"]);

    expect(result.exitCode).toBe(EXIT_GENERAL_ERROR);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("source checkout");
  });

  it("--json 付きなら、data の無い update envelope を stdout に出す", async () => {
    const result = await hop(["--update", "--check", "--json"]);

    expect(result.exitCode).toBe(EXIT_GENERAL_ERROR);
    const envelope = parse(UpdateEnvelopeSchema, JSON.parse(result.stdout));
    expect(envelope).toEqual({
      schemaVersion: 1,
      command: "update",
      warnings: [],
    });
    expect(result.stderr).toContain("source checkout");
  });

  it("未知の引数は exit 2 の usage error で拒否する (--chek の typo を --check と取り違えない)", async () => {
    const result = await hop(["--update", "--chek"]);

    expect(result.exitCode).toBe(EXIT_USAGE_ERROR);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("--chek");
    expect(result.stderr).toContain("hop --update [--check] [--json]");
  });

  it("usage error も --json 付きなら envelope で返す", async () => {
    const result = await hop(["--update", "--bogus", "--json"]);

    expect(result.exitCode).toBe(EXIT_USAGE_ERROR);
    const envelope = parse(UpdateEnvelopeSchema, JSON.parse(result.stdout));
    expect(envelope).toEqual({
      schemaVersion: 1,
      command: "update",
      warnings: [],
    });
  });
});

describe("hop --update --help", () => {
  it("--help / -h は更新も確認もせず、hop --help と同じ usage を stderr に出して exit 0 になる", async () => {
    const plain = await hop(["--help"]);

    for (const args of [
      ["--update", "--help"],
      ["--update", "-h"],
      ["--update", "--check", "--json", "--help"],
    ]) {
      // oxlint-disable-next-line no-await-in-loop
      const result = await hop(args);

      expect(result).toEqual({ exitCode: EXIT_SUCCESS, stdout: "", stderr: plain.stderr });
    }
  });
});

describe("hop --help", () => {
  it("usage に --update / --check / --version が載る", async () => {
    const result = await hop(["--help"]);

    expect(result.exitCode).toBe(EXIT_SUCCESS);
    expect(result.stderr).toContain("hop --update");
    expect(result.stderr).toContain("hop --update --check");
    expect(result.stderr).toContain("hop --version");
  });
});

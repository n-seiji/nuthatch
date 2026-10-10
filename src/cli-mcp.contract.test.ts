import { spawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { parse } from "valibot";
import {
  LsEnvelopeSchema,
  McpConfigEnvelopeSchema,
  StatusEnvelopeSchema,
} from "./domain/schema.ts";
import { runHop } from "./testing/cli.ts";
import { type TestRepo, createTestRepo } from "./testing/repo.ts";

const CLI_ENTRY = new URL("cli.ts", import.meta.url).pathname;

let repo: TestRepo;

beforeEach(async () => {
  repo = await createTestRepo();
});

afterEach(async () => {
  await repo.cleanup();
});

interface ServerRun {
  readonly responses: readonly Record<string, unknown>[];
  readonly stderr: string;
  readonly exitCode: number | null;
}

/** Starts `hop mcp`, writes `messages` (one JSON per line), closes stdin, and collects every stdout line. */
const runServer = (messages: readonly (object | string)[], cwd: string): Promise<ServerRun> =>
  new Promise((resolve, reject) => {
    const child = spawn("bun", ["run", CLI_ENTRY, "mcp"], { cwd, env: repo.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (exitCode) => {
      const responses = stdout
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      resolve({ responses, stderr, exitCode });
    });
    for (const message of messages) {
      child.stdin.write(`${typeof message === "string" ? message : JSON.stringify(message)}\n`);
    }
    child.stdin.end();
  });

const byId = (run: ServerRun, id: number): Record<string, unknown> | undefined =>
  run.responses.find((response) => response.id === id);

/** The `result` of the response to request `id`; throws (failing the test) if there is none. */
const resultOf = <T>(run: ServerRun, id: number): T => {
  const response = byId(run, id);
  if (response === undefined || !("result" in response)) {
    throw new Error(`no result for request ${id}`);
  }
  return response.result as T;
};

describe("hop mcp (stdio contract)", () => {
  it("initialize → tools/list → tools/call が JSON-RPC 応答だけを stdout に返す", async () => {
    await repo.git([
      "worktree",
      "add",
      "-b",
      "feat/mcp",
      `${repo.rootDir}/_worktree/repo/feat__mcp`,
    ]);

    const run = await runServer(
      [
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "test", version: "0" },
          },
        },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "list_worktrees", arguments: {} },
        },
        {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "worktree_status", arguments: { branch: "feat/mcp" } },
        },
        {
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: { name: "worktree_status", arguments: { branch: "nope" } },
        },
        "not json",
      ],
      repo.repoPath,
    );

    expect(run.exitCode).toBe(0);
    // One response per request with an id, plus the parse error; none for the notification.
    expect(run.responses).toHaveLength(6);
    expect(byId(run, 1)).toMatchObject({
      result: { protocolVersion: "2025-06-18", serverInfo: { name: "hop" } },
    });
    const tools = resultOf<{ tools: { name: string }[] }>(run, 2).tools.map((tool) => tool.name);
    expect(tools).toEqual(["list_worktrees", "worktree_status", "clean_candidates"]);

    const listed = resultOf<{ structuredContent: unknown; isError: boolean }>(run, 3);
    expect(listed.isError).toBe(false);
    expect(parse(LsEnvelopeSchema, listed.structuredContent).data).toHaveLength(2);

    const status = resultOf<{ structuredContent: unknown; isError: boolean }>(run, 4);
    expect(status.isError).toBe(false);
    expect(parse(StatusEnvelopeSchema, status.structuredContent).data).toMatchObject({
      branch: "feat/mcp",
      kind: "managed",
    });

    const missing = resultOf<{ content: { text: string }[]; isError: boolean }>(run, 5);
    expect(missing.isError).toBe(true);
    expect(missing.content.at(-1)?.text).toContain('No worktree found for branch "nope"');

    expect(run.responses.find((response) => response.id === null)).toMatchObject({
      error: { code: -32_700 },
    });
  });

  it("リポジトリ外の cwd を渡すと、落ちずにツールエラーを返す", async () => {
    const run = await runServer(
      [
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "list_worktrees", arguments: { cwd: repo.homeDir } },
        },
      ],
      repo.repoPath,
    );

    expect(run.exitCode).toBe(0);
    expect(byId(run, 1)).toMatchObject({ result: { isError: true } });
  });
});

describe("hop status / hop mcp config (CLI contract)", () => {
  it("status --json は StatusEnvelopeSchema を満たす", async () => {
    await repo.writeFile("dirty.txt", "x\n");

    const run = await runHop(["status", "--json"], repo.repoPath, repo.env);

    expect(run.exitCode).toBe(0);
    const parsed = parse(StatusEnvelopeSchema, JSON.parse(run.stdout));
    expect(parsed.command).toBe("status");
    expect(parsed.data).toMatchObject({
      kind: "root",
      dirty: true,
      changes: [{ status: "??", path: "dirty.txt" }],
    });
  });

  it("mcp config --json は McpConfigEnvelopeSchema を満たす", async () => {
    const run = await runHop(["mcp", "config", "--json"], repo.repoPath, repo.env);

    expect(run.exitCode).toBe(0);
    expect(
      parse(McpConfigEnvelopeSchema, JSON.parse(run.stdout)).data?.mcpServers.hop.args,
    ).toEqual(["mcp"]);
  });

  it("mcp install に知らない client を渡すと usage error (exit 2)", async () => {
    const run = await runHop(["mcp", "install", "cursor"], repo.repoPath, repo.env);

    expect(run.exitCode).toBe(2);
    expect(run.stdout).toBe("");
  });
});

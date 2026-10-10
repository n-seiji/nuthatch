import { createInterface } from "node:readline";
import { clean } from "./commands/clean.ts";
import { ls } from "./commands/ls.ts";
import { status } from "./commands/status.ts";
import { describeFatalError } from "./domain/fatal-error.ts";
import {
  type JsonRpcResponse,
  type McpAction,
  type McpToolCall,
  handleMcpMessage,
  parseErrorResponse,
  toolResult,
} from "./domain/mcp.ts";
import type { FsPort, GitPort, TermPort } from "./domain/ports.ts";
import type { CommandResult } from "./domain/result.ts";
import { toJsonEnvelope } from "./render.ts";
import { VERSION } from "./version.ts";

/**
 * `hop mcp` — the stdio half of the MCP server (the protocol rules are in
 * domain/mcp.ts). stdout carries nothing but JSON-RPC messages, one per line;
 * anything else hop would print goes to stderr, as everywhere in hop.
 *
 * Tools run the same commands the CLI does and return the same JSON
 * envelope, so `hop status --json` and the worktree_status tool can never
 * disagree.
 */

export interface McpServerPorts {
  readonly git: GitPort;
  readonly fs: FsPort;
  readonly term: TermPort;
}

interface ToolOutcome {
  readonly command: string;
  readonly result: CommandResult<unknown>;
}

const runTool = async (
  { git, fs, term }: McpServerPorts,
  call: McpToolCall,
  defaultCwd: string,
): Promise<ToolOutcome> => {
  const cwd = call.args.cwd ?? defaultCwd;
  switch (call.name) {
    case "list_worktrees": {
      return { command: "ls", result: await ls(git, fs, { cwd }) };
    }
    case "worktree_status": {
      const { branch } = call.args;
      return {
        command: "status",
        result: await status(git, fs, { cwd, ...(branch === undefined ? {} : { branch }) }),
      };
    }
    case "clean_candidates": {
      return {
        command: "clean",
        result: await clean(git, fs, term, {
          cwd,
          ext: call.args.ext ?? false,
          withBranch: false,
          dryRun: true,
          yes: false,
        }),
      };
    }
    default: {
      const exhaustive: never = call;
      throw new Error(`unhandled tool: ${JSON.stringify(exhaustive)}`);
    }
  }
};

const TOOL_COMMANDS = {
  list_worktrees: "ls",
  worktree_status: "status",
  clean_candidates: "clean",
} as const;

/** Runs one tool call to its tools/call response; a throw becomes a tool error, never a crash. */
export const callTool = async (
  ports: McpServerPorts,
  id: string | number | null,
  call: McpToolCall,
  defaultCwd: string,
): Promise<JsonRpcResponse> => {
  try {
    const { command, result } = await runTool(ports, call, defaultCwd);
    return toolResult(id, toJsonEnvelope(command, result), !result.ok, result.errorMessage);
  } catch (error) {
    const fatal = describeFatalError(error);
    const envelope = toJsonEnvelope(TOOL_COMMANDS[call.name], {
      ok: false,
      exitCode: fatal.exitCode,
    });
    return toolResult(id, envelope, true, fatal.message);
  }
};

const writeMessage = (response: JsonRpcResponse): void => {
  process.stdout.write(`${JSON.stringify(response)}\n`);
};

const parseLine = (
  line: string,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false } => {
  try {
    return { ok: true, value: JSON.parse(line) };
  } catch {
    return { ok: false };
  }
};

type McpToolAction = Extract<McpAction, { readonly kind: "callTool" }>;

/** Serves MCP on stdin/stdout until stdin closes, then waits for tool calls still running. */
export const runMcpServer = async (ports: McpServerPorts): Promise<void> => {
  const defaultCwd = process.cwd();
  const inFlight = new Set<Promise<void>>();
  const lines = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });

  const runAndReply = async (action: McpToolAction): Promise<void> => {
    writeMessage(await callTool(ports, action.id, action.call, defaultCwd));
  };

  for await (const line of lines) {
    const parsed = line.trim().length === 0 ? null : parseLine(line);
    if (parsed?.ok === false) {
      writeMessage(parseErrorResponse());
    } else if (parsed !== null) {
      const action = handleMcpMessage(parsed.value, VERSION);
      if (action.kind === "respond") {
        writeMessage(action.response);
      } else if (action.kind === "callTool") {
        // Tool calls run concurrently; each response carries its request id.
        const task = runAndReply(action);
        inFlight.add(task);
        // oxlint-disable-next-line promise/prefer-await-to-then -- bookkeeping only; awaited below
        void task.finally(() => inFlight.delete(task));
      }
    }
  }

  await Promise.all(inFlight);
};

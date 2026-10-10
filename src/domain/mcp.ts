import {
  type InferOutput,
  boolean,
  check,
  minLength,
  object,
  optional,
  pipe,
  safeParse,
  string,
} from "valibot";

/**
 * The protocol half of `hop mcp`, a Model Context Protocol server over stdio
 * (newline-delimited JSON-RPC 2.0). Pure: it turns one incoming message into
 * either a response to write or a tool call for the outer layer to run
 * (src/mcp-server.ts), so the protocol rules are unit-testable without a
 * process or a repository.
 *
 * Every tool is read-only: they wrap `hop ls`, `hop status` and
 * `hop clean --dry-run`, never a mutation, so an agent can inspect worktrees
 * through MCP without any of hop's safety rules being in play.
 */

/** Newest MCP revision this server speaks; offered when the client asks for one it doesn't know. */
export const LATEST_PROTOCOL_VERSION = "2025-11-25";

/** Revisions whose tools/list and tools/call shapes this server satisfies. */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [
  LATEST_PROTOCOL_VERSION,
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
];

export const JSON_RPC_PARSE_ERROR = -32_700;
export const JSON_RPC_INVALID_REQUEST = -32_600;
export const JSON_RPC_METHOD_NOT_FOUND = -32_601;
export const JSON_RPC_INVALID_PARAMS = -32_602;

export type JsonRpcId = string | number | null;

export type JsonRpcResponse =
  | { readonly jsonrpc: "2.0"; readonly id: JsonRpcId; readonly result: unknown }
  | {
      readonly jsonrpc: "2.0";
      readonly id: JsonRpcId;
      readonly error: { readonly code: number; readonly message: string };
    };

export type McpToolName = "list_worktrees" | "worktree_status" | "clean_candidates";

const AbsolutePathSchema = pipe(
  string(),
  check((value) => value.startsWith("/"), "cwd must be an absolute path"),
);

const CwdArgSchema = optional(AbsolutePathSchema);
const NonEmptyStringSchema = pipe(string(), minLength(1));
const BranchArgSchema = optional(NonEmptyStringSchema);

/** Arguments each tool accepts. `cwd` picks the repository; it defaults to the server's working directory. */
export const McpToolArgsSchemas = {
  list_worktrees: object({ cwd: CwdArgSchema }),
  worktree_status: object({ cwd: CwdArgSchema, branch: BranchArgSchema }),
  clean_candidates: object({ cwd: CwdArgSchema, ext: optional(boolean()) }),
} as const;

export type McpToolArgs = {
  readonly [Name in McpToolName]: InferOutput<(typeof McpToolArgsSchemas)[Name]>;
};

export type McpToolCall = {
  readonly [Name in McpToolName]: {
    readonly name: Name;
    readonly args: McpToolArgs[Name];
  };
}[McpToolName];

const CWD_PROPERTY = {
  type: "string",
  description:
    "Absolute path inside the repository (any of its worktrees). Defaults to the directory the MCP server was started in.",
} as const;

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/** What tools/list returns. Each inputSchema mirrors McpToolArgsSchemas (a unit test pins the match). */
export const MCP_TOOLS = [
  {
    name: "list_worktrees",
    title: "List worktrees",
    description:
      "List every git worktree of the repository, as `hop ls --json` does: path, branch, kind (root / managed / external), dirty, ahead/behind its upstream, and git's locked / prunable flags.",
    inputSchema: {
      type: "object",
      properties: { cwd: CWD_PROPERTY },
      additionalProperties: false,
    },
    annotations: { title: "List worktrees", ...READ_ONLY_ANNOTATIONS },
  },
  {
    name: "worktree_status",
    title: "Worktree status",
    description:
      "One worktree in detail, as `hop status --json` does: everything list_worktrees reports plus its uncommitted changes (git porcelain XY code and path), HEAD commit, upstream, and cleanReason — why `hop clean` would remove it (prunable / merged / gone), or null.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: CWD_PROPERTY,
        branch: {
          type: "string",
          description:
            "Branch whose worktree to report. Omit to report the worktree containing cwd.",
        },
      },
      additionalProperties: false,
    },
    annotations: { title: "Worktree status", ...READ_ONLY_ANNOTATIONS },
  },
  {
    name: "clean_candidates",
    title: "Clean candidates",
    description:
      "Worktrees `hop clean` would remove (prunable, merged into the default branch, or whose upstream is gone), as `hop clean --dry-run --json` does. Removes nothing.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: CWD_PROPERTY,
        ext: {
          type: "boolean",
          description:
            "Also consider external worktrees (not under hop's _worktree directory). Default false, matching hop clean.",
        },
      },
      additionalProperties: false,
    },
    annotations: { title: "Clean candidates", ...READ_ONLY_ANNOTATIONS },
  },
] as const;

/** Sent with the initialize result; clients may show it to the model. */
export const MCP_INSTRUCTIONS =
  "hop manages git worktrees, one branch per worktree under <root-parent>/_worktree/<repo>/<branch>. These tools only read. To create, remove or switch worktrees, run the hop CLI (`hop <branch> --create`, `hop rm <branch>`, `hop clean`, `hop root <branch>`), which enforces hop's safety checks.";

export type McpAction =
  | { readonly kind: "respond"; readonly response: JsonRpcResponse }
  | { readonly kind: "callTool"; readonly id: JsonRpcId; readonly call: McpToolCall }
  | { readonly kind: "ignore" };

const result = (id: JsonRpcId, value: unknown): McpAction => ({
  kind: "respond",
  response: { jsonrpc: "2.0", id, result: value },
});

const error = (id: JsonRpcId, code: number, message: string): McpAction => ({
  kind: "respond",
  response: { jsonrpc: "2.0", id, error: { code, message } },
});

type JsonObject = Readonly<Record<string, unknown>>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isId = (value: unknown): value is string | number =>
  typeof value === "string" || typeof value === "number";

const negotiateVersion = (params: unknown): string => {
  const requested = isObject(params) ? params.protocolVersion : undefined;
  return typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
    ? requested
    : LATEST_PROTOCOL_VERSION;
};

const isToolName = (name: unknown): name is McpToolName =>
  typeof name === "string" && Object.hasOwn(McpToolArgsSchemas, name);

const toolCall = (id: string | number, params: unknown): McpAction => {
  if (!isObject(params) || !isToolName(params.name)) {
    const name = isObject(params) ? String(params.name) : "";
    return error(id, JSON_RPC_INVALID_PARAMS, `Unknown tool: ${name}`);
  }
  const { name } = params;
  const parsed = safeParse(McpToolArgsSchemas[name], params.arguments ?? {});
  if (!parsed.success) {
    const issues = parsed.issues.map((issue) => issue.message).join("; ");
    return error(id, JSON_RPC_INVALID_PARAMS, `Invalid arguments for ${name}: ${issues}`);
  }
  // The schema lookup is keyed by `name`, so the parsed output matches that tool's args.
  return { kind: "callTool", id, call: { name, args: parsed.output } as McpToolCall };
};

/**
 * Decides what to do with one parsed JSON-RPC message. Notifications (no
 * `id`) never get a response, whatever their method.
 */
export const handleMcpMessage = (message: unknown, serverVersion: string): McpAction => {
  if (!isObject(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    // A response from the client (we never send requests) is not ours to answer.
    if (isObject(message) && ("result" in message || "error" in message)) {
      return { kind: "ignore" };
    }
    const id = isObject(message) && isId(message.id) ? message.id : null;
    return error(id, JSON_RPC_INVALID_REQUEST, "Invalid JSON-RPC request");
  }
  if (!isId(message.id)) {
    return { kind: "ignore" };
  }

  const { id, method, params } = message;
  switch (method) {
    case "initialize": {
      return result(id, {
        protocolVersion: negotiateVersion(params),
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "hop", title: "hop (nuthatch)", version: serverVersion },
        instructions: MCP_INSTRUCTIONS,
      });
    }
    case "ping": {
      return result(id, {});
    }
    case "tools/list": {
      return result(id, { tools: MCP_TOOLS });
    }
    case "tools/call": {
      return toolCall(id, params);
    }
    default: {
      return error(id, JSON_RPC_METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  }
};

/**
 * The tools/call result for a finished tool: hop's usual JSON envelope, both
 * as structured content and as text (for clients that only read text). A
 * failed command is a tool error the model can read, not a protocol error.
 */
export const toolResult = (
  id: JsonRpcId,
  envelope: object,
  failed: boolean,
  errorMessage?: string,
): JsonRpcResponse => ({
  jsonrpc: "2.0",
  id,
  result: {
    content: [
      { type: "text", text: JSON.stringify(envelope) },
      ...(errorMessage === undefined ? [] : [{ type: "text", text: errorMessage }]),
    ],
    structuredContent: envelope,
    isError: failed,
  },
});

/** The response for a line that is not JSON at all. */
export const parseErrorResponse = (): JsonRpcResponse => ({
  jsonrpc: "2.0",
  id: null,
  error: { code: JSON_RPC_PARSE_ERROR, message: "Parse error" },
});

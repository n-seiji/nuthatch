import type { CommandArgv } from "./install-method.ts";
import type { McpConfigData } from "./schema.ts";

/**
 * Clients `hop mcp install` registers hop with. claude / codex have their
 * own `mcp add` command, which hop runs so the client stays the only writer
 * of its config; cursor / opencode have none, so hop edits their user-level
 * JSON config file itself (see mergeMcpConfig for how carefully).
 */
export const MCP_CLIENTS = ["claude", "codex", "cursor", "opencode"] as const;
export type McpClient = (typeof MCP_CLIENTS)[number];
export type McpCliClient = Extract<McpClient, "claude" | "codex">;
export type McpFileClient = Extract<McpClient, "cursor" | "opencode">;

export const isMcpClient = (value: string): value is McpClient =>
  (MCP_CLIENTS as readonly string[]).includes(value);

export const isMcpFileClient = (client: McpClient): client is McpFileClient =>
  client === "cursor" || client === "opencode";

/** The name hop's server is registered under in every client. */
export const MCP_SERVER_NAME = "hop";

/** How a client starts the server: hop itself, with the `mcp` subcommand. */
export const mcpServerConfig = (hopCommand: string): McpConfigData => ({
  mcpServers: { [MCP_SERVER_NAME]: { command: hopCommand, args: ["mcp"] } },
});

/**
 * The client CLI invocation that registers hop's server. Claude Code gets
 * `--scope user`: hop works in whatever repository the session is in (the
 * server defaults to its working directory, which the client sets to the
 * project), so one registration should cover every project. Codex's
 * `mcp add` is user-wide already.
 */
export const mcpInstallArgv = (
  client: McpCliClient,
  clientPath: string,
  hopCommand: string,
): CommandArgv =>
  client === "claude"
    ? [clientPath, "mcp", "add", "--scope", "user", MCP_SERVER_NAME, "--", hopCommand, "mcp"]
    : [clientPath, "mcp", "add", MCP_SERVER_NAME, "--", hopCommand, "mcp"];

/** The key holding servers in each client's config, and hop's entry under it. */
const fileClientEntry = (client: McpFileClient, hopCommand: string) =>
  client === "cursor"
    ? { key: "mcpServers", entry: { command: hopCommand, args: ["mcp"] } }
    : { key: "mcp", entry: { type: "local", command: [hopCommand, "mcp"], enabled: true } };

export type McpConfigMerge =
  | { readonly kind: "write"; readonly text: string }
  | { readonly kind: "unchanged" }
  | { readonly kind: "refuse"; readonly message: string };

type JsonObject = Record<string, unknown>;

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseObject = (text: string): JsonObject | null => {
  try {
    const parsed: unknown = JSON.parse(text);
    return isJsonObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const JSON_INDENT = 2;

/**
 * Adds hop's server to a cursor / opencode config file's text (null: the
 * file does not exist yet). It only ever adds: every other key is kept, an
 * identical hop entry is left alone, and anything it cannot edit safely is
 * refused rather than overwritten — a file that is not plain JSON (opencode
 * also accepts JSONC, whose comments a rewrite would drop), or a `hop`
 * entry that differs from what hop would write (the user's own, to keep).
 * A written file is re-indented with two spaces.
 */
export const mergeMcpConfig = (
  client: McpFileClient,
  existingText: string | null,
  hopCommand: string,
): McpConfigMerge => {
  const config = existingText === null ? {} : parseObject(existingText);
  if (config === null) {
    return {
      kind: "refuse",
      message:
        "it is not a plain JSON object (comments are not supported), so hop will not rewrite it",
    };
  }
  const { key, entry } = fileClientEntry(client, hopCommand);
  const servers = config[key] ?? {};
  if (!isJsonObject(servers)) {
    return { kind: "refuse", message: `its "${key}" is not an object` };
  }
  const existing = servers[MCP_SERVER_NAME];
  if (existing !== undefined) {
    return JSON.stringify(existing) === JSON.stringify(entry)
      ? { kind: "unchanged" }
      : {
          kind: "refuse",
          message: `it already has a different "${MCP_SERVER_NAME}" server under "${key}"; remove or edit that entry yourself`,
        };
  }
  const updated = { ...config, [key]: { ...servers, [MCP_SERVER_NAME]: entry } };
  return { kind: "write", text: `${JSON.stringify(updated, null, JSON_INDENT)}\n` };
};

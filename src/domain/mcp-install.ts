import type { CommandArgv } from "./install-method.ts";
import type { McpConfigData } from "./schema.ts";

/** Clients `hop mcp install` registers hop with, through each client's own CLI. */
export const MCP_CLIENTS = ["claude", "codex"] as const;
export type McpClient = (typeof MCP_CLIENTS)[number];

export const isMcpClient = (value: string): value is McpClient =>
  (MCP_CLIENTS as readonly string[]).includes(value);

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
  client: McpClient,
  clientPath: string,
  hopCommand: string,
): CommandArgv =>
  client === "claude"
    ? [clientPath, "mcp", "add", "--scope", "user", MCP_SERVER_NAME, "--", hopCommand, "mcp"]
    : [clientPath, "mcp", "add", MCP_SERVER_NAME, "--", hopCommand, "mcp"];

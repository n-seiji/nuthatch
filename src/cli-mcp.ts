import { defineCommand } from "citty";
import { mcpConfig, mcpInstall } from "./commands/mcp-install.ts";
import { MCP_CLIENTS, isMcpClient } from "./domain/mcp-install.ts";
import type { McpInstallPort } from "./domain/ports.ts";
import { EXIT_USAGE_ERROR } from "./domain/result.ts";
import { createMcpInstallPort } from "./infra/mcp-install.ts";
import { type McpServerPorts, runMcpServer } from "./mcp-server.ts";
import { reportResult } from "./render.ts";

const usageError = (message: string): void => {
  process.stderr.write(`${message}\n`);
  process.exitCode = EXIT_USAGE_ERROR;
};

/**
 * `hop mcp` (serve MCP on stdio), `hop mcp install <client> [--dry-run]`
 * and `hop mcp config`. One citty command with an optional action
 * positional rather than citty subCommands, for the reason cli.ts's dispatch
 * comment gives.
 */
export const createMcpCommand = (
  serverPorts: McpServerPorts,
  installPort: McpInstallPort = createMcpInstallPort(),
) =>
  defineCommand({
    meta: { name: "mcp", description: "Serve hop's read-only tools over MCP (stdio)" },
    args: {
      action: {
        type: "positional",
        required: false,
        description: "install | config (omit to serve)",
      },
      client: {
        type: "positional",
        required: false,
        description: `Client for install (${MCP_CLIENTS.join(" | ")})`,
      },
      dryRun: { type: "boolean", description: "Only print the command install would run" },
      json: { type: "boolean", description: "Output JSON" },
    },
    async run({ args }) {
      const json = Boolean(args.json);
      const action = args.action === undefined ? undefined : String(args.action);
      if (action === undefined) {
        await runMcpServer(serverPorts);
        return;
      }
      if (action === "config") {
        reportResult("mcp", await mcpConfig(installPort), json);
        return;
      }
      if (action !== "install") {
        usageError(
          `Unknown hop mcp action: ${action}. Use "hop mcp", "hop mcp install <client>" or "hop mcp config".`,
        );
        return;
      }
      const client = args.client === undefined ? "" : String(args.client);
      if (!isMcpClient(client)) {
        usageError(`hop mcp install needs a client: ${MCP_CLIENTS.join(" or ")}.`);
        return;
      }
      reportResult(
        "mcp",
        await mcpInstall(installPort, { client, dryRun: Boolean(args.dryRun) }),
        json,
      );
    },
  });

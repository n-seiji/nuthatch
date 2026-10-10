import { messageOf } from "../domain/fatal-error.ts";
import type { CommandArgv } from "../domain/install-method.ts";
import { type McpClient, mcpInstallArgv, mcpServerConfig } from "../domain/mcp-install.ts";
import type { McpInstallPort } from "../domain/ports.ts";
import { type CommandResult, EXIT_GENERAL_ERROR, fail, ok } from "../domain/result.ts";
import type { McpConfigData, McpInstallData } from "../domain/schema.ts";

export interface McpInstallOptions {
  readonly client: McpClient;
  /** Only report the command that would register hop; run nothing. */
  readonly dryRun: boolean;
}

/**
 * How a client should start hop: by absolute path when hop is on PATH, so a
 * client launched without the user's shell profile (a GUI app, for one)
 * still finds it; the bare name otherwise.
 */
const hopCommand = async (port: McpInstallPort): Promise<string> =>
  (await port.resolveExecutable("hop")) ?? "hop";

/** The client's exit code, or why it could not be run at all. */
const runClient = async (port: McpInstallPort, command: CommandArgv): Promise<number | string> => {
  try {
    return await port.runCommand(command);
  } catch (error) {
    return messageOf(error);
  }
};

/** `hop mcp config` — the `mcpServers` entry for clients configured by editing a JSON file. */
export const mcpConfig = async (port: McpInstallPort): Promise<CommandResult<McpConfigData>> =>
  ok({ data: mcpServerConfig(await hopCommand(port)) });

/**
 * `hop mcp install <client>` — registers `hop mcp` with a client by running
 * that client's own `mcp add` command, so the client stays the owner of its
 * config file and hop never edits it.
 */
export const mcpInstall = async (
  port: McpInstallPort,
  options: McpInstallOptions,
): Promise<CommandResult<McpInstallData>> => {
  const clientPath = await port.resolveExecutable(options.client);
  if (clientPath === null) {
    return fail(
      EXIT_GENERAL_ERROR,
      `"${options.client}" was not found on PATH. Install it first, or add hop to your client by hand with the entry \`hop mcp config\` prints.`,
    );
  }

  const command = mcpInstallArgv(options.client, clientPath, await hopCommand(port));
  if (options.dryRun) {
    return ok({ data: { client: options.client, command: [...command], ran: false } });
  }

  const exitCode = await runClient(port, command);
  if (typeof exitCode === "string") {
    return fail(EXIT_GENERAL_ERROR, `Could not run ${options.client}: ${exitCode}`);
  }
  if (exitCode !== 0) {
    return fail(
      EXIT_GENERAL_ERROR,
      `${options.client} mcp add exited with ${exitCode} (see its output above). If hop is already registered, nothing more is needed.`,
    );
  }
  return ok({ data: { client: options.client, command: [...command], ran: true } });
};

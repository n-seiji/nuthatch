import { messageOf } from "../domain/fatal-error.ts";
import type { CommandArgv } from "../domain/install-method.ts";
import {
  type McpCliClient,
  type McpClient,
  type McpFileClient,
  isMcpFileClient,
  mcpInstallArgv,
  mcpServerConfig,
  mergeMcpConfig,
} from "../domain/mcp-install.ts";
import type { McpInstallPort } from "../domain/ports.ts";
import { type CommandResult, EXIT_GENERAL_ERROR, fail, ok } from "../domain/result.ts";
import type { McpConfigData, McpInstallData } from "../domain/schema.ts";

export interface McpInstallOptions {
  readonly client: McpClient;
  /** Only report what would register hop; run and write nothing. */
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

/** For claude / codex: run the client's own `mcp add`. */
const installWithCli = async (
  port: McpInstallPort,
  client: McpCliClient,
  dryRun: boolean,
): Promise<CommandResult<McpInstallData>> => {
  const clientPath = await port.resolveExecutable(client);
  if (clientPath === null) {
    return fail(
      EXIT_GENERAL_ERROR,
      `"${client}" was not found on PATH. Install it first, or add hop to your client by hand with the entry \`hop mcp config\` prints.`,
    );
  }

  const argv = mcpInstallArgv(client, clientPath, await hopCommand(port));
  const command = [...argv];
  const data = (ran: boolean): McpInstallData => ({
    client,
    method: "cli",
    command,
    configPath: null,
    ran,
  });
  if (dryRun) {
    return ok({ data: data(false) });
  }

  const exitCode = await runClient(port, argv);
  if (typeof exitCode === "string") {
    return fail(EXIT_GENERAL_ERROR, `Could not run ${client}: ${exitCode}`);
  }
  if (exitCode !== 0) {
    return fail(
      EXIT_GENERAL_ERROR,
      `${client} mcp add exited with ${exitCode} (see its output above). If hop is already registered, nothing more is needed.`,
    );
  }
  return ok({ data: data(true) });
};

/** For cursor / opencode: add hop's entry to the user-level config file (see mergeMcpConfig). */
const installWithFile = async (
  port: McpInstallPort,
  client: McpFileClient,
  dryRun: boolean,
): Promise<CommandResult<McpInstallData>> => {
  const configPath = await port.configPath(client);
  const merge = mergeMcpConfig(client, await port.readTextFile(configPath), await hopCommand(port));
  if (merge.kind === "refuse") {
    return fail(
      EXIT_GENERAL_ERROR,
      `Not changing ${configPath}: ${merge.message}. Add hop by hand with the entry \`hop mcp config\` prints.`,
    );
  }
  const data = (ran: boolean): McpInstallData => ({
    client,
    method: "file",
    command: null,
    configPath,
    ran,
  });
  if (merge.kind === "unchanged") {
    return ok({ data: data(false), warnings: [`hop is already registered in ${configPath}.`] });
  }
  if (dryRun) {
    return ok({ data: data(false) });
  }
  await port.writeTextFile(configPath, merge.text);
  return ok({ data: data(true) });
};

/**
 * `hop mcp install <client>` — registers `hop mcp` with a client, user-wide:
 * through the client's own CLI where it has one (claude / codex), otherwise
 * by adding one entry to its config file (cursor / opencode).
 */
export const mcpInstall = (
  port: McpInstallPort,
  options: McpInstallOptions,
): Promise<CommandResult<McpInstallData>> =>
  isMcpFileClient(options.client)
    ? installWithFile(port, options.client, options.dryRun)
    : installWithCli(port, options.client, options.dryRun);

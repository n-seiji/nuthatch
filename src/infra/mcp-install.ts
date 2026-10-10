import type { McpInstallPort } from "../domain/ports.ts";
import { resolveExecutable, runCommand } from "./package-manager.ts";

/**
 * `hop mcp install` locates and runs a client CLI (claude / codex) exactly the
 * way `hop --update` runs a package manager: by absolute path, with an argv
 * array, in the home directory, its output on stderr.
 */
export const createMcpInstallPort = (): McpInstallPort => ({
  resolveExecutable: (name) => resolveExecutable(name, process.env.PATH),
  runCommand,
});

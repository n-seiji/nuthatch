import { readFile, rename, rm, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import type { McpFileClient } from "../domain/mcp-install.ts";
import type { McpInstallPort } from "../domain/ports.ts";
import { resolveExecutable, runCommand } from "./package-manager.ts";

const isMissing = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";

const readTextFile = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissing(error)) {
      return null;
    }
    throw error;
  }
};

const fileExists = async (path: string): Promise<boolean> => (await readTextFile(path)) !== null;

const opencodeConfigPath = async (home: string, xdg: string | undefined): Promise<string> => {
  const base = xdg !== undefined && isAbsolute(xdg) ? xdg : join(home, ".config");
  const json = join(base, "opencode", "opencode.json");
  const jsonc = join(base, "opencode", "opencode.jsonc");
  return !(await fileExists(json)) && (await fileExists(jsonc)) ? jsonc : json;
};

/** Write to a sibling temp file, then rename over the target, so a crash never leaves half a config. */
const writeTextFile = async (path: string, text: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.hop-${process.pid}.tmp`;
  try {
    await writeFile(temp, text, { encoding: "utf8", mode: 0o600 });
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
};

/**
 * `hop mcp install` locates and runs a client CLI (claude / codex) exactly the
 * way `hop --update` runs a package manager: by absolute path, with an argv
 * array, in the home directory, its output on stderr. For cursor / opencode
 * it reads and writes their user-level config file.
 */
export const createMcpInstallPort = (
  home: string = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): McpInstallPort => ({
  resolveExecutable: (name) => resolveExecutable(name, env.PATH),
  runCommand,
  configPath: (client: McpFileClient) =>
    client === "cursor"
      ? Promise.resolve(join(home, ".cursor", "mcp.json"))
      : opencodeConfigPath(home, env.XDG_CONFIG_HOME),
  readTextFile,
  writeTextFile,
});

import { realpath } from "node:fs/promises";
import type { InstallFacts } from "../domain/install-method.ts";

/**
 * The process's own state, passed in (not read from `process`) so tests can
 * describe an install without being that process.
 */
export interface InstallFactsSource {
  /** Running as a `bun build --compile` binary (the cli layer decides that). */
  readonly compiled: boolean;
  /** `process.execPath`: a compiled binary's own path, otherwise the runtime's. */
  readonly execPath: string;
  /** `process.argv[1]`: the entry script, or the launcher symlink for an npm bin. */
  readonly argv1: string | undefined;
  readonly platform: string;
  readonly arch: string;
}

/** A path that cannot be resolved is still worth matching against as written. */
const realpathOrSelf = async (path: string): Promise<string> => {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
};

/**
 * Both paths are realpath'd, because how hop is launched hides where it
 * lives: an npm bin is a symlink (`argv[1]` is the link, not the script).
 */
export const readInstallFacts = async (source: InstallFactsSource): Promise<InstallFacts> => ({
  compiled: source.compiled,
  executablePath: source.compiled ? await realpathOrSelf(source.execPath) : null,
  scriptPath:
    source.compiled || source.argv1 === undefined ? null : await realpathOrSelf(source.argv1),
  platform: source.platform,
  arch: source.arch,
});

import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import type { InstallFacts } from "../domain/install-method.ts";
import {
  type MiseToolFacts,
  miseToolDir,
  parseLegacyMiseBackend,
  parseMiseBackendToml,
} from "../domain/mise-tool.ts";

/**
 * Gathers the facts domain/install-method.ts decides on. The process's own
 * state is passed in (not read from `process`) so tests can describe an
 * install layout on disk without being that process.
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

/** The marker mise writes in a tool's install dir to record which backend installed it. */
const MISE_BACKEND_TOML = ".mise.backend.toml";
/** The plain-text marker older mise versions write instead (some installs carry both). */
const MISE_BACKEND_LEGACY = ".mise.backend";

/** A path that cannot be resolved is still worth matching against as written. */
const realpathOrSelf = async (path: string): Promise<string> => {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
};

const readTextOrNull = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
};

/** The backend a tool dir's marker records: the toml when it names one, else the legacy file. */
const readMiseBackend = async (dir: string): Promise<string | null> => {
  const toml = await readTextOrNull(join(dir, MISE_BACKEND_TOML));
  const fromToml = toml === null ? null : parseMiseBackendToml(toml);
  if (fromToml !== null) {
    return fromToml;
  }
  const legacy = await readTextOrNull(join(dir, MISE_BACKEND_LEGACY));
  return legacy === null ? null : parseLegacyMiseBackend(legacy);
};

/**
 * The mise tool dir (`…/installs/<tool>`) `path` lives in and what its marker
 * says — whichever tool that is. Whether it is hop's tool is the domain's call.
 */
const findMiseTool = async (path: string | null): Promise<MiseToolFacts | null> => {
  const dir = path === null ? null : miseToolDir(path);
  return dir === null ? null : { dir, backend: await readMiseBackend(dir) };
};

/**
 * Both paths are realpath'd, because how hop is launched hides where it
 * lives: an npm bin is a symlink (`argv[1]` is the link, not the script), and
 * a mise tool is reached through its `latest` link.
 */
export const readInstallFacts = async (source: InstallFactsSource): Promise<InstallFacts> => {
  const executablePath = source.compiled ? await realpathOrSelf(source.execPath) : null;
  const scriptPath =
    source.compiled || source.argv1 === undefined ? null : await realpathOrSelf(source.argv1);
  return {
    compiled: source.compiled,
    executablePath,
    scriptPath,
    mise: await findMiseTool(executablePath ?? scriptPath),
    platform: source.platform,
    arch: source.arch,
  };
};

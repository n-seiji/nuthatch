import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import type { CommandArgv } from "../domain/install-method.ts";
import { pathExecutableCandidates } from "../domain/self-update.ts";

/**
 * Locating and running a package manager (mise / npm / bun) for
 * `hop --update`. Like git (git-executable.ts), the program is resolved to an
 * absolute path first and never spawned by bare name, and it is always
 * spawned with an argv array — never through a shell.
 */

const STDERR_FD = 2;

/** A child killed by a signal has no exit code; it is reported as a plain failure. */
const KILLED_BY_SIGNAL_EXIT_CODE = 1;

const isExecutableFile = async (path: string): Promise<boolean> => {
  try {
    const stats = await stat(path);
    if (!stats.isFile()) {
      return false;
    }
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * The first executable file named `name` in an absolute PATH entry, or null.
 * Every probe is launched at once and awaited in PATH order, so the first
 * entry wins and nothing waits past it.
 */
export const resolveExecutable = async (name: string, pathEnv?: string): Promise<string | null> => {
  const probes = pathExecutableCandidates(name, pathEnv).map(async (candidate) =>
    (await isExecutableFile(candidate)) ? candidate : null,
  );
  for (const probe of probes) {
    // oxlint-disable-next-line no-await-in-loop
    const found = await probe;
    if (found !== null) {
      return found;
    }
  }
  return null;
};

/**
 * Runs `argv` with stdin inherited (a package manager may prompt) and the
 * child's stdout *and* stderr both on hop's stderr: hop's own stdout is
 * reserved for the JSON envelope / plain data the shell wrapper captures, so
 * a chatty child must never end up there. Rejects if the process cannot be
 * started; otherwise resolves to its exit code.
 */
export const runCommand = (argv: CommandArgv): Promise<number> =>
  new Promise((resolve, reject) => {
    const [program, ...args] = argv;
    const child = spawn(program, args, {
      stdio: ["inherit", STDERR_FD, STDERR_FD],
    });
    child.once("error", reject);
    child.once("close", (code) => {
      resolve(code ?? KILLED_BY_SIGNAL_EXIT_CODE);
    });
  });

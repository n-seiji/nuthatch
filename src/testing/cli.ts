import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

/**
 * Launches the real `hop` entrypoint (src/cli.ts) — or a compiled `hop`
 * binary — as an actual child process, for contract tests that need the CLI's
 * real argv parsing, exit code and stdout-vs-stderr split rather than the
 * CommandResult object commands/*.ts return. Shared so the shape of a failed
 * `execFile` — the fragile part — is maintained in one place.
 */

const CLI_ENTRYPOINT = new URL("../cli.ts", import.meta.url).pathname;

export interface CliRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs `program` with `args` and reports how it ended; a non-zero exit is a result, not a throw. */
export const runProgram = async (
  program: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<CliRunResult> => {
  try {
    const { stdout, stderr } = await execFile(program, [...args], {
      cwd,
      env,
    });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const { code, stdout, stderr } = error as {
      code?: number;
      stdout: string;
      stderr: string;
    };
    return { exitCode: code ?? 1, stdout, stderr };
  }
};

export const runHop = (
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<CliRunResult> => runProgram("bun", ["run", CLI_ENTRYPOINT, ...args], cwd, env);

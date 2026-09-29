/**
 * Turns anything that escaped a command into the one line hop prints on
 * stderr plus the exit code from docs/design.md's CLI contract. Without this
 * an unexpected throw reaches the runtime's default handler, which prints a
 * raw JS stack trace (issue #9) — unreadable, and exit 1 even for a git
 * failure the contract pins at 3.
 */
import { GIT_EXECUTABLE_OVERRIDE_ENV, GIT_NOT_FOUND_ERROR_CODE } from "./git-executable.ts";
import { EXIT_GENERAL_ERROR, EXIT_SAFE_REJECTION, type ExitCode } from "./result.ts";

export interface FatalErrorReport {
  readonly message: string;
  readonly exitCode: ExitCode;
}

interface ErrorLikeFields {
  readonly code?: unknown;
  readonly signal?: unknown;
  readonly stderr?: unknown;
  readonly path?: unknown;
  readonly syscall?: unknown;
  readonly message?: unknown;
}

const fieldsOf = (error: unknown): ErrorLikeFields =>
  typeof error === "object" && error !== null ? (error as ErrorLikeFields) : {};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const trimmedStringOf = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** A spawn that never reached the program: the binary itself wasn't there. */
const isSpawnFailure = (fields: ErrorLikeFields): boolean =>
  fields.code === "ENOENT" && trimmedStringOf(fields.syscall).startsWith("spawn");

/** The git process ran and exited non-zero, or was killed by a signal. */
const isGitFailure = (fields: ErrorLikeFields): boolean =>
  typeof fields.code === "number" || trimmedStringOf(fields.signal).length > 0;

export const describeFatalError = (error: unknown): FatalErrorReport => {
  const fields = fieldsOf(error);

  if (fields.code === GIT_NOT_FOUND_ERROR_CODE) {
    return { message: messageOf(error), exitCode: EXIT_GENERAL_ERROR };
  }

  if (isSpawnFailure(fields)) {
    const binary = trimmedStringOf(fields.path) || "git";
    return {
      message:
        `failed to run ${binary}: no such executable. ` +
        `Install git, or set ${GIT_EXECUTABLE_OVERRIDE_ENV} to its absolute path.`,
      exitCode: EXIT_GENERAL_ERROR,
    };
  }

  if (isGitFailure(fields)) {
    const stderr = trimmedStringOf(fields.stderr);
    return {
      message: stderr.length > 0 ? stderr : messageOf(error),
      exitCode: EXIT_SAFE_REJECTION,
    };
  }

  return { message: messageOf(error), exitCode: EXIT_GENERAL_ERROR };
};

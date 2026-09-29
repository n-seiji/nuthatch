/**
 * Turns anything that escaped a command into the one line hop prints on
 * stderr plus the exit code from docs/design.md's CLI contract. Without this
 * an unexpected throw reaches the runtime's default handler, which prints a
 * raw JS stack trace (issue #9) — unreadable, and exit 1 even for a git
 * failure the contract pins at 3.
 */
import { GIT_NOT_FOUND_HINT } from "./git-executable.ts";
import {
  EXIT_GENERAL_ERROR,
  EXIT_SAFE_REJECTION,
  type EXIT_SUCCESS,
  type ExitCode,
} from "./result.ts";

export interface FatalErrorReport {
  readonly message: string;
  /** Never EXIT_SUCCESS: a fatal error always leaves a non-zero exit code. */
  readonly exitCode: Exclude<ExitCode, typeof EXIT_SUCCESS>;
}

type ErrorFields = Record<string, unknown>;

const fieldsOf = (error: unknown): ErrorFields =>
  typeof error === "object" && error !== null ? (error as ErrorFields) : {};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const trimmedStringOf = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** A spawn that never reached the program: the binary itself wasn't there. */
const isSpawnFailure = (fields: ErrorFields): boolean =>
  fields.code === "ENOENT" &&
  typeof fields.syscall === "string" &&
  fields.syscall.startsWith("spawn");

/** The git process ran and exited non-zero, or was killed by a signal. */
const isGitFailure = (fields: ErrorFields): boolean =>
  typeof fields.code === "number" || (typeof fields.signal === "string" && fields.signal !== "");

export const describeFatalError = (error: unknown): FatalErrorReport => {
  const fields = fieldsOf(error);

  if (isSpawnFailure(fields)) {
    const binary = trimmedStringOf(fields.path) || "git";
    return {
      message: `failed to run ${binary}: no such executable. ${GIT_NOT_FOUND_HINT}`,
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

  /*
   * Everything else, including the GIT_NOT_FOUND_ERROR_CODE error from
   * infra/git-executable.ts: its message already names every candidate and
   * the remediation, so it is shown as-is with the contract's generic code.
   */
  return { message: messageOf(error), exitCode: EXIT_GENERAL_ERROR };
};

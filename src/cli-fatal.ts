import { describeFatalError } from "./domain/fatal-error.ts";
import { fail } from "./domain/result.ts";
import { render } from "./render.ts";

/**
 * The CLI's fatal-error surface. An error a command let escape (a git
 * failure, a missing git binary) is rendered through the same path as a
 * rejection the command returned itself, so `hop: <line>` goes to stderr and
 * a requested `--json` still gets its envelope instead of the runtime's raw
 * stack trace (issue #9).
 */

/**
 * True if `--json` was asked for. Read off the raw argv rather than citty's
 * parse result, because a fatal error can happen before (or instead of) a
 * successful parse.
 */
export const wantsJson = (args: readonly string[]): boolean =>
  args.some((arg) => arg === "--json" || arg.startsWith("--json="));

export const reportFatalError = (command: string, json: boolean, error: unknown): void => {
  const fatal = describeFatalError(error);
  const result = fail(fatal.exitCode, `hop: ${fatal.message}`);
  render(command, result, json);
  process.exitCode = result.exitCode;
};

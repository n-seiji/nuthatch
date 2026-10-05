import { parseArgs } from "citty";
import { isRunningAsCompiledBinary } from "./cli-dispatch.ts";
import { reportFatalError, wantsJson } from "./cli-fatal.ts";
import { selfUpdate } from "./commands/self-update.ts";
import type { TermPort } from "./domain/ports.ts";
import { EXIT_USAGE_ERROR, fail } from "./domain/result.ts";
import { createSelfUpdatePort } from "./infra/self-update.ts";
import { reportResult } from "./render.ts";
import { VERSION } from "./version.ts";

/**
 * `hop --update`'s CLI side: argument parsing, wiring the real port into the
 * command, and reporting. Kept out of cli.ts for the same reason as
 * cli-pick.ts: the entry point stays a thin dispatcher.
 */

const UPDATE_ARGS = {
  check: { type: "boolean", description: "Only report; change nothing" },
  json: { type: "boolean", description: "Output JSON" },
} as const;

const UPDATE_FLAGS: ReadonlySet<string> = new Set(["--check", "--json"]);

export type UpdateArgs =
  | { readonly ok: true; readonly check: boolean; readonly json: boolean }
  | { readonly ok: false; readonly json: boolean; readonly message: string };

/**
 * Parses what follows `--update`. Anything but `--check` / `--json` is
 * refused instead of ignored, because here the default is the dangerous
 * direction: with the usual lenient parsing a typo like `--chek` would
 * quietly turn a read-only check into a real update.
 */
export const parseUpdateArgs = (tokens: readonly string[]): UpdateArgs => {
  const stray = tokens.filter((token) => !UPDATE_FLAGS.has(token));
  if (stray.length > 0) {
    return {
      ok: false,
      json: wantsJson(tokens),
      message: `Unknown argument for --update: ${stray.join(" ")}. Usage: hop --update [--check] [--json]`,
    };
  }
  const args = parseArgs([...tokens], UPDATE_ARGS);
  return { ok: true, check: Boolean(args.check), json: Boolean(args.json) };
};

/** `hop --update …`: `rawArgs` still has `--update` as its first token. */
export const runUpdate = async (rawArgs: readonly string[], term: TermPort): Promise<void> => {
  try {
    const parsed = parseUpdateArgs(rawArgs.slice(1));
    if (!parsed.ok) {
      reportResult("update", fail(EXIT_USAGE_ERROR, parsed.message), parsed.json);
      return;
    }
    const port = createSelfUpdatePort({
      compiled: isRunningAsCompiledBinary(),
      version: VERSION,
    });
    const result = await selfUpdate(port, term, {
      currentVersion: VERSION,
      check: parsed.check,
    });
    reportResult("update", result, parsed.json);
  } catch (error) {
    reportFatalError("update", wantsJson(rawArgs), error);
  }
};

export type CliDispatch =
  | {
      readonly kind: "jump";
      readonly args: readonly string[];
    }
  | {
      readonly kind: "reserved";
      readonly name: string;
      readonly args: readonly string[];
    };

/**
 * Drops Bun's synthesized argv0 for compiled-binary invocations only.
 *
 * `bun build --compile` binaries append the invocation name (matching
 * `process.argv0`) to `process.argv` whenever they're started with no
 * arguments — regardless of whether stdout is a TTY. The shell wrapper
 * (`hop init zsh`) always captures stdout via `$(command hop "$@")`, so
 * stdout is a pipe in the exact real-world path this needs to handle; a
 * check on stdout-is-TTY would never strip the synthesized token there.
 */
export const normalizeCliArgs = (
  rawArgs: readonly string[],
  argv0: string,
  isCompiledBinary: boolean,
): readonly string[] =>
  isCompiledBinary && rawArgs.length === 1 && rawArgs[0] === argv0 ? [] : rawArgs;

/**
 * True when running as a `bun build --compile` binary (as opposed to
 * `bun run src/cli.ts`, the npm/Node build, or a plain Node process).
 * Compiled binaries embed sources under a synthetic `/$bunfs/` root, which
 * `Bun.main` reflects; source runs report a real file path, and Node
 * doesn't have a `Bun` global at all.
 */
export const isRunningAsCompiledBinary = (): boolean =>
  typeof Bun !== "undefined" && Bun.main.startsWith("/$bunfs/");

const HELP_FLAGS: ReadonlySet<string> = new Set(["--help", "-h", "help"]);

/**
 * Detects a top-level help request. Only the first raw token matters, so
 * `hop -- help` (escaped branch jump) never triggers help — dispatchCliArgs
 * treats a leading `--` as the escape marker before this check would apply.
 */
export const isHelpRequest = (rawArgs: readonly string[]): boolean =>
  rawArgs.length > 0 && HELP_FLAGS.has(rawArgs[0] ?? "");

/** Routes reserved subcommands while letting every other token be a branch. */
export const dispatchCliArgs = (
  rawArgs: readonly string[],
  reservedNames: readonly string[],
): CliDispatch => {
  const [first, ...rest] = rawArgs;
  if (first === "--") {
    return { kind: "jump", args: rest };
  }
  if (first !== undefined && reservedNames.includes(first)) {
    return { kind: "reserved", name: first, args: rest };
  }
  return { kind: "jump", args: rawArgs };
};

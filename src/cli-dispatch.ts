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

/** Drops Bun's synthesized argv0 only for the compiled TTY invocation case. */
export const normalizeCliArgs = (
  rawArgs: readonly string[],
  argv0: string,
  stdoutIsTTY: boolean,
): readonly string[] =>
  stdoutIsTTY && rawArgs.length === 1 && rawArgs[0] === argv0 ? [] : rawArgs;

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

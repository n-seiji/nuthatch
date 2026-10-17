/**
 * The argv parser hop uses for every command. It replaced citty, whose entry
 * module imports consola: about 100 KB of a 257 KB bundle, plus node:tty /
 * node:readline / node:util loaded at every start, when hop only ever used
 * citty to split flags from positionals.
 *
 * The rules are citty's (mri's), kept so the CLI reads argv exactly as before:
 * - `--` ends flag parsing; everything after it is positional.
 * - `--name` / `--name=value`; `--kebab-name` and `--camelName` are the same
 *   flag. `--no-name` sets a boolean flag to false.
 * - A boolean flag never consumes the next token; `--name=false` is false.
 * - A string flag takes the next token as its value unless that token starts
 *   with `-` (then its value is "").
 * - An undeclared flag (long, or each letter of a short `-abc`) is ignored, but
 *   still takes the next token as its value unless that token starts with `-`.
 *
 * One deliberate difference: a bare `-` is a positional. citty dropped it,
 * which is why `hop root -` needed a sentinel rewrite before parsing.
 */

export interface ArgsSpec {
  /** Positional names, in order; `required` ones throw when missing. */
  readonly positionals?: readonly { readonly name: string; readonly required: boolean }[];
  readonly booleans?: readonly string[];
  readonly strings?: readonly string[];
}

export interface ParsedArgs {
  readonly positionals: Readonly<Record<string, string | undefined>>;
  readonly booleans: Readonly<Record<string, boolean>>;
  readonly strings: Readonly<Record<string, string | undefined>>;
}

const DASH = "-";
const FLAG_PREFIX = "--";
const NEGATION_PREFIX = "no-";

/** `dry-run` → `dryRun`; an already-camel name passes through unchanged. */
const camelize = (name: string): string =>
  name.replaceAll(/-(?<letter>[a-z])/gu, (_match, letter: string) => letter.toUpperCase());

const parseBooleanValue = (value: string): boolean => value !== "false";

interface ParseState {
  readonly booleans: Record<string, boolean>;
  readonly strings: Record<string, string | undefined>;
  readonly positionals: string[];
}

/** Handles one `-…` token; returns how many following tokens it consumed. */
const parseFlagToken = (
  token: string,
  next: string | undefined,
  spec: { readonly booleans: ReadonlySet<string>; readonly strings: ReadonlySet<string> },
  state: ParseState,
): number => {
  const nextIsValue = next !== undefined && !next.startsWith(DASH);
  const isLong = token.startsWith(FLAG_PREFIX);
  const body = token.slice(isLong ? FLAG_PREFIX.length : DASH.length);

  if (isLong && body.startsWith(NEGATION_PREFIX)) {
    const name = camelize(body.slice(NEGATION_PREFIX.length));
    if (spec.booleans.has(name)) {
      state.booleans[name] = false;
    }
    return 0;
  }

  const equalsIndex = body.indexOf("=");
  const rawName = equalsIndex === -1 ? body : body.slice(0, equalsIndex);
  const inlineValue = equalsIndex === -1 ? undefined : body.slice(equalsIndex + 1);
  // A short cluster (`-abc`) is three flags; only the last can take a value,
  // And none of them is declared (hop has no short flags), so only the
  // Consumption rule matters.
  const name = isLong ? camelize(rawName) : rawName.slice(-1);

  if (spec.booleans.has(name)) {
    state.booleans[name] = inlineValue === undefined || parseBooleanValue(inlineValue);
    return 0;
  }
  if (spec.strings.has(name)) {
    if (inlineValue !== undefined) {
      state.strings[name] = inlineValue;
      return 0;
    }
    state.strings[name] = nextIsValue ? next : "";
    return nextIsValue ? 1 : 0;
  }
  return inlineValue === undefined && nextIsValue ? 1 : 0;
};

export const parseCliArgs = (tokens: readonly string[], spec: ArgsSpec): ParsedArgs => {
  const flagSpec = {
    booleans: new Set(spec.booleans),
    strings: new Set(spec.strings),
  };
  const state: ParseState = { booleans: {}, strings: {}, positionals: [] };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (token === FLAG_PREFIX) {
      state.positionals.push(...tokens.slice(index + 1));
      break;
    }
    if (token === DASH || !token.startsWith(DASH)) {
      state.positionals.push(token);
    } else {
      index += parseFlagToken(token, tokens[index + 1], flagSpec, state);
    }
  }

  const positionals: Record<string, string | undefined> = {};
  for (const [index, { name, required }] of (spec.positionals ?? []).entries()) {
    const value = state.positionals[index];
    if (value === undefined && required) {
      throw new Error(`Missing required positional argument: ${name.toUpperCase()}`);
    }
    positionals[name] = value;
  }

  const booleans: Record<string, boolean> = {};
  for (const name of flagSpec.booleans) {
    booleans[name] = state.booleans[name] ?? false;
  }

  return { positionals, booleans, strings: state.strings };
};

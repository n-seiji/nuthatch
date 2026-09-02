/** Exit codes fixed by docs/design.md's CLI contract. */
export type ExitCode = 0 | 1 | 2 | 3 | 130;

/**
 * Structured outcome returned by every command. Commands never render —
 * cli.ts + render.ts turn this into stdout/stderr/JSON.
 */
export interface CommandResult<T> {
  readonly ok: boolean;
  readonly exitCode: ExitCode;
  /** Present on success when the command's job is to report a path (jump, root). */
  readonly path?: string;
  readonly data?: T;
  readonly warnings?: readonly string[];
  readonly errorMessage?: string;
}

export const ok = <T>(
  fields: Omit<CommandResult<T>, "ok" | "exitCode"> = {},
): CommandResult<T> => ({
  ok: true,
  exitCode: 0,
  ...fields,
});

export const fail = <T>(
  exitCode: Exclude<ExitCode, 0>,
  errorMessage: string,
): CommandResult<T> => ({
  ok: false,
  exitCode,
  errorMessage,
});

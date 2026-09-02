/** Exit codes fixed by docs/design.md's CLI contract. */
export const EXIT_SUCCESS = 0;
export const EXIT_GENERAL_ERROR = 1;
export const EXIT_USAGE_ERROR = 2;
export const EXIT_SAFE_REJECTION = 3;
export const EXIT_CANCELLED = 130;

export type ExitCode =
  | typeof EXIT_SUCCESS
  | typeof EXIT_GENERAL_ERROR
  | typeof EXIT_USAGE_ERROR
  | typeof EXIT_SAFE_REJECTION
  | typeof EXIT_CANCELLED;

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
  exitCode: EXIT_SUCCESS,
  ...fields,
});

export const fail = <T>(
  exitCode: Exclude<ExitCode, typeof EXIT_SUCCESS>,
  errorMessage: string,
): CommandResult<T> => ({
  ok: false,
  exitCode,
  errorMessage,
});

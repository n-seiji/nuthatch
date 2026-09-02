import type { CommandResult } from "./domain/result.ts";

export interface JsonEnvelope<T> {
  readonly schemaVersion: 1;
  readonly command: string;
  readonly data: T | undefined;
  readonly warnings: readonly string[];
}

/** Turns a command Result into stdout/stderr output. Only cli.ts calls this. */
export const render = <T>(command: string, result: CommandResult<T>, json: boolean): void => {
  if (json) {
    const envelope: JsonEnvelope<T | undefined> = {
      schemaVersion: 1,
      command,
      data: result.ok ? result.data : undefined,
      warnings: result.warnings ?? [],
    };
    process.stdout.write(`${JSON.stringify(envelope)}\n`);
    if (!result.ok && result.errorMessage !== undefined) {
      process.stderr.write(`${result.errorMessage}\n`);
    }
    return;
  }

  if (result.path !== undefined) {
    process.stdout.write(`${result.path}\n`);
  } else if (result.ok && result.data !== undefined) {
    process.stdout.write(`${JSON.stringify(result.data, null, 2)}\n`);
  }

  for (const warning of result.warnings ?? []) {
    process.stderr.write(`warning: ${warning}\n`);
  }

  if (!result.ok && result.errorMessage !== undefined) {
    process.stderr.write(`${result.errorMessage}\n`);
  }
};

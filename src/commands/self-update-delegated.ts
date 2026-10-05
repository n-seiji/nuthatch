import { messageOf } from "../domain/fatal-error.ts";
import { type DelegatedMethod, upgradeCommand } from "../domain/install-method.ts";
import type { SelfUpdatePort, TermPort } from "../domain/ports.ts";
import { type CommandResult, EXIT_GENERAL_ERROR, fail, ok } from "../domain/result.ts";
import type { UpdateData } from "../domain/schema.ts";
import { attempt } from "./self-update-attempt.ts";

/**
 * Update for a mise / npm / bun install: hop does not touch files itself, it
 * runs the package manager's own upgrade command. The program is looked up on PATH
 * (never spawned by bare name) and a missing one is reported with the exact
 * command to run by hand. A zero exit only means the command succeeded: the
 * package manager may still decide not to move (e.g. a pinned mise version).
 */
export const runDelegated = async (
  port: SelfUpdatePort,
  term: TermPort,
  method: DelegatedMethod,
  base: UpdateData,
): Promise<CommandResult<UpdateData>> => {
  const argv = upgradeCommand(method);
  const [program, ...args] = argv;
  const command = argv.join(" ");

  const executable = await port.resolveExecutable(program);
  if (executable === null) {
    return fail(
      EXIT_GENERAL_ERROR,
      `Cannot find "${program}" on PATH. Run it yourself: ${command}`,
    );
  }

  term.logStderr(`Running: ${command}`);
  const run = await attempt(() => port.runCommand([executable, ...args]));
  if (!run.ok) {
    return fail(EXIT_GENERAL_ERROR, `Failed to run ${command}: ${messageOf(run.error)}`);
  }
  if (run.value !== 0) {
    return fail(EXIT_GENERAL_ERROR, `${command} exited with code ${run.value}.`);
  }

  term.logStderr(`${command} finished; run "hop --version" to see which version you have now.`);
  return ok({ data: { ...base, action: "delegated", command: [...argv] } });
};

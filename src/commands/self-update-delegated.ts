import { messageOf } from "../domain/fatal-error.ts";
import {
  type CommandArgv,
  type DelegatedMethod,
  type MiseMethod,
  miseDryRunCommand,
  preferredProgramDir,
  upgradeCommand,
} from "../domain/install-method.ts";
import type { SelfUpdatePort, TermPort } from "../domain/ports.ts";
import { type CommandResult, EXIT_GENERAL_ERROR, fail, ok } from "../domain/result.ts";
import type { UpdateData } from "../domain/schema.ts";
import { type Attempt, attempt } from "./self-update-attempt.ts";

/** What `mise upgrade --dry-run-code` exits with when `mise upgrade` would not change anything. */
const MISE_WOULD_NOT_UPGRADE = 0;

/**
 * Runs `argv` with its program replaced by the absolute path it resolved to,
 * and says on stderr that it is doing so with exactly that line: which npm or
 * mise ran is what a surprising update needs explaining by.
 */
const runLogged = (
  port: SelfUpdatePort,
  term: TermPort,
  executable: string,
  [, ...args]: CommandArgv,
): Promise<Attempt<number>> => {
  const command: CommandArgv = [executable, ...args];
  term.logStderr(`Running: ${command.join(" ")}`);
  return attempt(() => port.runCommand(command));
};

const miseNothingToUpgradeWarning = (
  { tool }: MiseMethod,
  { current, latest }: UpdateData,
): string =>
  [
    `mise has nothing to upgrade for ${tool}, so hop stays at ${current} although ${latest} is the latest release.`,
    "Likely causes: the version is pinned in your global mise config, a minimum_release_age setting holds the release back,",
    `or ${tool} is not in your global mise config (hop runs mise from your home directory, so a project's mise.toml does not count).`,
    `Run "mise upgrade --dry-run ${tool}" from your home directory to see what mise decides.`,
  ].join(" ");

/**
 * Update for a mise / npm / bun install: hop does not touch files itself, it
 * runs the package manager's own upgrade command. The program is looked up on PATH
 * (never spawned by bare name) and a missing one is reported with the exact
 * command to run by hand. A zero exit only means the command succeeded: the
 * package manager may still decide not to move, which is why mise — whose
 * `upgrade` does exactly that for a pinned version — is asked first.
 */
export const runDelegated = async (
  port: SelfUpdatePort,
  term: TermPort,
  method: DelegatedMethod,
  base: UpdateData,
): Promise<CommandResult<UpdateData>> => {
  const argv = upgradeCommand(method);
  const [program] = argv;
  const command = argv.join(" ");

  const executable = await port.resolveExecutable(program, preferredProgramDir(method));
  if (executable === null) {
    return fail(
      EXIT_GENERAL_ERROR,
      `Cannot find "${program}" on PATH. Run it yourself: ${command}`,
    );
  }

  if (method.kind === "mise") {
    /*
     * Exit 0: nothing to upgrade, so stop here. 1: it would upgrade, go on. Any
     * other code (a mise too old to know the flag exits 2) is no answer, and the
     * upgrade runs as it always did. A question that cannot be run at all
     * (cannot start, killed by a signal) fails the update instead of falling
     * through to the real upgrade it was meant to guard.
     */
    const question = miseDryRunCommand(method);
    const answer = await runLogged(port, term, executable, question);
    if (!answer.ok) {
      return fail(
        EXIT_GENERAL_ERROR,
        `Failed to run ${question.join(" ")}: ${messageOf(answer.error)}`,
      );
    }
    if (answer.value === MISE_WOULD_NOT_UPGRADE) {
      return ok({ data: base, warnings: [miseNothingToUpgradeWarning(method, base)] });
    }
  }

  const run = await runLogged(port, term, executable, argv);
  if (!run.ok) {
    return fail(EXIT_GENERAL_ERROR, `Failed to run ${command}: ${messageOf(run.error)}`);
  }
  if (run.value !== 0) {
    return fail(EXIT_GENERAL_ERROR, `${command} exited with code ${run.value}.`);
  }

  term.logStderr(`${command} finished; run "hop --version" to see which version you have now.`);
  return ok({ data: { ...base, action: "delegated", command: [...argv] } });
};

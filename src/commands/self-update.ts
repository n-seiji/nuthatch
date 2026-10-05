import { messageOf } from "../domain/fatal-error.ts";
import {
  type UpdatableMethod,
  detectInstallMethod,
  latestChannel,
  upgradeCommand,
} from "../domain/install-method.ts";
import type { SelfUpdatePort, TermPort } from "../domain/ports.ts";
import { type CommandResult, EXIT_GENERAL_ERROR, fail, ok } from "../domain/result.ts";
import type { UpdateData } from "../domain/schema.ts";
import { compareVersions } from "../domain/self-update.ts";
import { attempt } from "./self-update-attempt.ts";
import { runDelegated } from "./self-update-delegated.ts";
import { replaceStandalone } from "./self-update-standalone.ts";

export interface SelfUpdateOptions {
  /** The running hop's version. Injected by cli.ts: commands never import src/version.ts. */
  readonly currentVersion: string;
  /** Only report. Reads the install facts and the latest version, nothing else. */
  readonly check: boolean;
}

interface LatestRelease {
  readonly latest: string;
  readonly updateAvailable: boolean;
}

const fetchLatest = (port: SelfUpdatePort, method: UpdatableMethod): Promise<string> =>
  latestChannel(method) === "npm" ? port.latestNpmVersion() : port.latestGithubVersion();

/** What `--check` says would run: a package manager's command, or nothing for a standalone binary. */
const checkCommand = (method: UpdatableMethod): string[] | null =>
  method.kind === "standalone" ? null : [...upgradeCommand(method)];

const describeCheck = (method: UpdatableMethod, base: UpdateData): string => {
  const how =
    method.kind === "standalone"
      ? `replaces ${method.binaryPath}`
      : `runs: ${upgradeCommand(method).join(" ")}`;
  return `Update available: ${base.current} -> ${base.latest}. "hop --update" ${how}.`;
};

/**
 * `hop --update` — updates hop the way it was installed (see
 * domain/install-method.ts). The order is the safety net: the install method
 * is decided before anything goes over the network, so an install hop cannot
 * update (a source checkout, npx) is refused without any request; `--check`
 * stops once it has compared versions; and an installed version that is the
 * same as or newer than the latest is never "updated" back.
 *
 * Exit codes: 0 updated / already up to date / `--check`; 1 an unsupported
 * install or any network, package-manager or write failure; 3 a download
 * that failed checksum verification.
 */
export const selfUpdate = async (
  port: SelfUpdatePort,
  term: TermPort,
  options: SelfUpdateOptions,
): Promise<CommandResult<UpdateData>> => {
  const method = detectInstallMethod(await port.installFacts());
  if (method.kind === "unsupported") {
    return fail(EXIT_GENERAL_ERROR, `Cannot update hop: ${method.reason}.`);
  }

  term.logStderr("Checking for the latest release...");
  const release = await attempt(async (): Promise<LatestRelease> => {
    const latest = await fetchLatest(port, method);
    return {
      latest,
      updateAvailable: compareVersions(latest, options.currentVersion) > 0,
    };
  });
  if (!release.ok) {
    return fail(
      EXIT_GENERAL_ERROR,
      `Failed to check for the latest release: ${messageOf(release.error)}`,
    );
  }

  const base: UpdateData = {
    current: options.currentVersion,
    latest: release.value.latest,
    updateAvailable: release.value.updateAvailable,
    method: method.kind,
    action: "none",
    command: null,
  };
  if (!base.updateAvailable) {
    term.logStderr(`hop ${base.current} is up to date (latest release: ${base.latest}).`);
    return ok({ data: base });
  }
  if (options.check) {
    term.logStderr(describeCheck(method, base));
    return ok({ data: { ...base, command: checkCommand(method) } });
  }
  return method.kind === "standalone"
    ? replaceStandalone(port, term, method, base)
    : runDelegated(port, term, method, base);
};

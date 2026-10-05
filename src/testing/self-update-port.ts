import type { InstallFacts } from "../domain/install-method.ts";
import type { SelfUpdatePort, TermPort } from "../domain/ports.ts";
import type { UpdateData } from "../domain/schema.ts";

/**
 * In-memory stand-ins for the self-update command's ports. Anything a test
 * does not provide throws "unexpected call: <name>" instead of silently
 * doing nothing, so a side effect that must not happen (a download under
 * `--check`, a spawn for an unsupported install) fails the test loudly, and
 * `calls` records exactly which port methods a run touched.
 */

export interface FakeSelfUpdate {
  readonly port: SelfUpdatePort;
  readonly term: TermPort;
  /** Port method names, in call order. */
  readonly calls: string[];
  /** Lines the command logged to stderr. */
  readonly logs: string[];
}

const recorded =
  <Args extends readonly unknown[], Result>(
    name: string,
    calls: string[],
    implementation: ((...args: Args) => Result) | undefined,
  ) =>
  (...args: Args): Result => {
    calls.push(name);
    if (implementation === undefined) {
      throw new Error(`unexpected call: ${name}`);
    }
    return implementation(...args);
  };

export const createFakeSelfUpdate = (overrides: Partial<SelfUpdatePort> = {}): FakeSelfUpdate => {
  const calls: string[] = [];
  const logs: string[] = [];
  const port: SelfUpdatePort = {
    installFacts: recorded("installFacts", calls, overrides.installFacts),
    latestGithubVersion: recorded("latestGithubVersion", calls, overrides.latestGithubVersion),
    latestNpmVersion: recorded("latestNpmVersion", calls, overrides.latestNpmVersion),
    downloadReleaseAsset: recorded("downloadReleaseAsset", calls, overrides.downloadReleaseAsset),
    downloadReleaseText: recorded("downloadReleaseText", calls, overrides.downloadReleaseText),
    sha256Hex: recorded("sha256Hex", calls, overrides.sha256Hex),
    replaceExecutable: recorded("replaceExecutable", calls, overrides.replaceExecutable),
    resolveExecutable: recorded("resolveExecutable", calls, overrides.resolveExecutable),
    runCommand: recorded("runCommand", calls, overrides.runCommand),
  };
  const term: TermPort = {
    isTTY: () => false,
    logStderr: (message) => {
      logs.push(message);
    },
    confirm: () => Promise.resolve(false),
  };
  return { port, term, calls, logs };
};

/** Install facts for a plain, unrecognised script on darwin-arm64; override what a test is about. */
export const installFactsOf = (overrides: Partial<InstallFacts> = {}): InstallFacts => ({
  compiled: false,
  executablePath: null,
  scriptPath: null,
  mise: null,
  platform: "darwin",
  arch: "arm64",
  ...overrides,
});

export const standaloneFacts = (binaryPath = "/home/u/.local/bin/hop"): InstallFacts =>
  installFactsOf({ compiled: true, executablePath: binaryPath });

const MISE_INSTALLS = "/home/u/.local/share/mise/installs";

/** A compiled hop in a mise tool dir whose marker records `tool` (mise names the dir after the id). */
export const miseFacts = (tool = "github:n-seiji/nuthatch"): InstallFacts => {
  const dir = `${MISE_INSTALLS}/${tool.replaceAll(/[^a-z0-9]+/giu, "-")}`;
  return installFactsOf({
    compiled: true,
    executablePath: `${dir}/0.1.4/hop`,
    mise: { dir, backend: tool },
  });
};

export const npmFacts = (): InstallFacts =>
  installFactsOf({
    scriptPath: "/usr/local/lib/node_modules/@n-seiji/nuthatch/dist/cli.js",
  });

export const bunFacts = (): InstallFacts =>
  installFactsOf({
    scriptPath: "/home/u/.bun/install/global/node_modules/@n-seiji/nuthatch/dist/cli.js",
  });

export const sourceCheckoutFacts = (): InstallFacts =>
  installFactsOf({ scriptPath: "/home/u/ghq/github.com/n-seiji/nuthatch/src/cli.ts" });

/** The data an update that is about to be applied starts from (before `action` / `command` change). */
export const updateDataOf = (overrides: Partial<UpdateData> = {}): UpdateData => ({
  current: "0.1.4",
  latest: "0.1.5",
  updateAvailable: true,
  method: "standalone",
  action: "none",
  command: null,
  ...overrides,
});

import type { SelfUpdatePort } from "../domain/ports.ts";
import { readInstallFacts } from "./install-facts.ts";
import { resolveExecutable, runCommand } from "./package-manager.ts";
import { replaceExecutable, sha256Hex } from "./release-binary.ts";
import { createReleaseHttp } from "./release-http.ts";

export interface SelfUpdatePortOptions {
  /** Running as a `bun build --compile` binary. The cli layer owns that check (cli-dispatch.ts). */
  readonly compiled: boolean;
  /** The running hop's version, sent as `User-Agent: hop/<version>`. */
  readonly version: string;
}

/** The real `hop --update` port: the network, the binary on disk, package managers. */
export const createSelfUpdatePort = ({
  compiled,
  version,
}: SelfUpdatePortOptions): SelfUpdatePort => ({
  installFacts: () =>
    readInstallFacts({
      compiled,
      execPath: process.execPath,
      argv1: process.argv[1],
      platform: process.platform,
      arch: process.arch,
    }),
  ...createReleaseHttp(`hop/${version}`),
  sha256Hex,
  replaceExecutable,
  resolveExecutable: (name) => resolveExecutable(name, process.env.PATH),
  runCommand,
});

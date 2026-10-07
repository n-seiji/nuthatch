import { chmod, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  detectInstallMethod,
  preferredProgramDir,
  upgradeCommand,
} from "../domain/install-method.ts";
import {
  createLayoutSandbox,
  createNpmGlobalHop,
  installSourceOf,
  touch,
} from "../testing/install-layout.ts";
import { readInstallFacts } from "./install-facts.ts";
import { resolveExecutable } from "./package-manager.ts";

/**
 * The scenario behind "a second hop appears and the old one stays": hop
 * installed by one node's npm while another node's npm comes first on PATH.
 * Real files, no fakes — facts, decision, command and executable lookup
 * composed the way `hop --update` composes them.
 */

let sandbox: string;

beforeEach(async () => {
  sandbox = await createLayoutSandbox();
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

const makeNpm = async (dir: string): Promise<string> => {
  const npm = join(dir, "npm");
  await touch(npm, "#!/bin/sh\n");
  await chmod(npm, 0o755);
  return npm;
};

describe("npm のグローバルインストールの更新先", () => {
  it("PATH の先頭に別の node の npm があっても、hop の prefix にある npm を、その prefix を指定して使う", async () => {
    const prefix = join(sandbox, "node-a");
    const { bin } = await createNpmGlobalHop(prefix);
    const ownNpm = await makeNpm(join(prefix, "bin"));
    const otherBin = join(sandbox, "node-b", "bin");
    await makeNpm(otherBin);

    const method = detectInstallMethod(await readInstallFacts(installSourceOf({ argv1: bin })));
    if (method.kind !== "npm") {
      throw new Error(`expected an npm install, got ${method.kind}`);
    }
    const argv = upgradeCommand(method);
    const npm = await resolveExecutable(argv[0], otherBin, preferredProgramDir(method));

    expect(npm).toBe(ownNpm);
    expect(argv).toEqual(["npm", "install", "-g", "--prefix", prefix, "@n-seiji/nuthatch@latest"]);
  });

  it("hop の prefix に npm が無い場合は PATH の npm を使うが、更新先の prefix は変わらない", async () => {
    const prefix = join(sandbox, "custom-prefix");
    const { bin } = await createNpmGlobalHop(prefix);
    const otherBin = join(sandbox, "node-b", "bin");
    const pathNpm = await makeNpm(otherBin);

    const method = detectInstallMethod(await readInstallFacts(installSourceOf({ argv1: bin })));
    if (method.kind !== "npm") {
      throw new Error(`expected an npm install, got ${method.kind}`);
    }
    const argv = upgradeCommand(method);
    const npm = await resolveExecutable(argv[0], otherBin, preferredProgramDir(method));

    expect(npm).toBe(pathNpm);
    expect(argv).toContain(prefix);
  });

  it("Homebrew の formula が std_npm_args で入れた keg の libexec は、bin/hop で prefix を確認できても更新せず、brew upgrade を案内する", async () => {
    const prefix = join(sandbox, "Cellar", "nuthatch", "0.1.5", "libexec");
    const { bin } = await createNpmGlobalHop(prefix);

    const facts = await readInstallFacts(installSourceOf({ argv1: bin }));
    const method = detectInstallMethod(facts);

    expect(facts.npmGlobalPrefix).toBe(prefix);
    expect(method.kind).toBe("unsupported");
    expect(method.kind === "unsupported" ? method.reason : "").toContain('"brew upgrade"');
  });
});

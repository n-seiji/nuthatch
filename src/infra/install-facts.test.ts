import { mkdir, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { detectInstallMethod } from "../domain/install-method.ts";
import {
  createLayoutSandbox,
  createNpmGlobalHop,
  installSourceOf,
  touch,
} from "../testing/install-layout.ts";
import { readInstallFacts } from "./install-facts.ts";

/**
 * Facts for installs that are not under a mise tool dir. The mise layouts
 * (and every case about what a marker says) are in install-facts-mise.test.ts.
 */

let sandbox: string;

beforeEach(async () => {
  sandbox = await createLayoutSandbox();
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

describe("readInstallFacts", () => {
  it("単独のバイナリの場合、executablePath だけを実体のパスで返す", async () => {
    const real = join(sandbox, "real", "hop");
    await touch(real);
    await mkdir(join(sandbox, "bin"), { recursive: true });
    await symlink(real, join(sandbox, "bin", "hop"));

    const facts = await readInstallFacts(
      installSourceOf({
        compiled: true,
        execPath: join(sandbox, "bin", "hop"),
        arch: "x64",
      }),
    );

    expect(facts).toEqual({
      compiled: true,
      executablePath: real,
      scriptPath: null,
      mise: null,
      npmGlobalPrefix: null,
      platform: "darwin",
      arch: "x64",
    });
  });

  it("npm のグローバルインストール (bin のリンク経由) の場合、scriptPath を実体のパスで、npmGlobalPrefix を確認済みの prefix で返す", async () => {
    const prefix = join(sandbox, "prefix");
    const { script, bin } = await createNpmGlobalHop(prefix);

    const facts = await readInstallFacts(installSourceOf({ argv1: bin }));

    expect(facts).toMatchObject({
      compiled: false,
      executablePath: null,
      scriptPath: script,
      mise: null,
      npmGlobalPrefix: prefix,
    });
    expect(detectInstallMethod(facts)).toEqual({ kind: "npm", prefix });
  });

  it("<prefix>/bin/hop が無い場合 (プロジェクトの lib/node_modules など)、npmGlobalPrefix は null で、プロジェクト依存として unsupported になる", async () => {
    const script = join(sandbox, "repo/packages/lib/node_modules/@n-seiji/nuthatch/dist/cli.js");
    await touch(script);

    const facts = await readInstallFacts(installSourceOf({ argv1: script }));

    expect(facts.npmGlobalPrefix).toBeNull();
    expect(detectInstallMethod(facts)).toEqual({
      kind: "unsupported",
      reason: expect.stringContaining("project dependency"),
    });
  });

  it("<prefix>/bin/hop が別のスクリプトを指している場合、npmGlobalPrefix は null になる (動いている hop の prefix ではない)", async () => {
    const { script: other } = await createNpmGlobalHop(join(sandbox, "installed"));
    const prefix = join(sandbox, "copy");
    const script = join(prefix, "lib/node_modules/@n-seiji/nuthatch/dist/cli.js");
    await touch(script);
    await mkdir(join(prefix, "bin"), { recursive: true });
    await symlink(other, join(prefix, "bin", "hop"));

    const facts = await readInstallFacts(installSourceOf({ argv1: script }));

    expect(facts.scriptPath).toBe(script);
    expect(facts.npmGlobalPrefix).toBeNull();
  });

  it("<prefix>/bin/hop が壊れたリンクの場合、npmGlobalPrefix は null になる", async () => {
    const { script, bin } = await createNpmGlobalHop(join(sandbox, "prefix"));
    await rm(bin);
    await symlink(join(sandbox, "gone"), bin);

    const facts = await readInstallFacts(installSourceOf({ argv1: script }));

    expect(facts.npmGlobalPrefix).toBeNull();
  });

  it("ソースチェックアウトの場合、scriptPath はそのままで、source checkout と判定される", async () => {
    const script = join(sandbox, "nuthatch", "src", "cli.ts");
    await touch(script);

    const facts = await readInstallFacts(installSourceOf({ argv1: script }));

    expect(facts.scriptPath).toBe(script);
    expect(facts.mise).toBeNull();
    expect(detectInstallMethod(facts)).toEqual({
      kind: "unsupported",
      reason: expect.stringContaining("source checkout"),
    });
  });

  it("実体が解決できないパスの場合、与えられたパスをそのまま使う", async () => {
    const missing = join(sandbox, "gone", "cli.js");

    const facts = await readInstallFacts(installSourceOf({ argv1: missing }));

    expect(facts.scriptPath).toBe(missing);
  });

  it("スクリプトの場所が無い場合、scriptPath は null になる", async () => {
    const facts = await readInstallFacts(installSourceOf({ argv1: undefined }));

    expect(facts.scriptPath).toBeNull();
    expect(facts.mise).toBeNull();
  });
});

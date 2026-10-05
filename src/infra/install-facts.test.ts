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
      platform: "darwin",
      arch: "x64",
    });
  });

  it("npm のグローバルインストール (bin のリンク経由) の場合、scriptPath を実体のパスで返す", async () => {
    const { script, bin } = await createNpmGlobalHop(join(sandbox, "prefix"));

    const facts = await readInstallFacts(installSourceOf({ argv1: bin }));

    expect(facts).toMatchObject({
      compiled: false,
      executablePath: null,
      scriptPath: script,
      mise: null,
    });
    expect(detectInstallMethod(facts)).toEqual({ kind: "npm" });
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

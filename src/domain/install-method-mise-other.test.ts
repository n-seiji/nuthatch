import { describe, expect, it } from "bun:test";
import { installFactsOf } from "../testing/self-update-port.ts";
import { type InstallFacts, detectInstallMethod } from "./install-method.ts";
import type { MiseToolFacts } from "./mise-tool.ts";

/**
 * Hop inside a mise tool dir (`<…>/installs/<tool>`) that is not a mise install
 * of hop: the dir belongs to another tool, or its marker cannot be read. What
 * a mise install of hop looks like is in install-method.test.ts.
 */

const INSTALLS = "/home/u/.local/share/mise/installs";
const NPM_GLOBAL_SCRIPT = "/usr/local/lib/node_modules/@n-seiji/nuthatch/dist/cli.js";

/** A mise tool dir named `name` whose marker records `backend` (null: no readable marker). */
const miseDir = (name: string, backend: string | null): MiseToolFacts => ({
  dir: `${INSTALLS}/${name}`,
  backend,
});

/** The reason an install is refused; throws if it is not refused at all. */
const reasonOf = (value: InstallFacts): string => {
  const method = detectInstallMethod(value);
  if (method.kind !== "unsupported") {
    throw new Error(`expected an unsupported install, got ${method.kind}`);
  }
  return method.reason;
};

describe("detectInstallMethod: mise のマーカーが hop のものでない場合", () => {
  it("mise の node (core:node) 配下に npm i -g した場合、そのマーカーは無視して npm になる", () => {
    const method = detectInstallMethod(
      installFactsOf({
        scriptPath: `${INSTALLS}/node/25.6.1/lib/node_modules/@n-seiji/nuthatch/dist/cli.js`,
        mise: miseDir("node", "core:node"),
      }),
    );

    expect(method).toEqual({ kind: "npm" });
  });

  it("別ツールのマーカー配下のコンパイル済みバイナリは、マーカーを無視して standalone になる", () => {
    const method = detectInstallMethod(
      installFactsOf({
        compiled: true,
        executablePath: `${INSTALLS}/bun/1.2.0/bin/hop`,
        mise: miseDir("bun", "core:bun"),
      }),
    );

    expect(method.kind).toBe("standalone");
  });

  it("別ツールのマーカーを無視した先でも、他のルールは通常どおり効く (ソースチェックアウトは拒否のまま)", () => {
    const reason = reasonOf(
      installFactsOf({
        scriptPath: `${INSTALLS}/node/25.6.1/src/cli.ts`,
        mise: miseDir("node", "core:node"),
      }),
    );

    expect(reason).toContain("source checkout");
  });

  it("hop 名らしいディレクトリでも、読めたマーカーが別ツールなら hop のものとは見なさない", () => {
    const method = detectInstallMethod(
      installFactsOf({
        scriptPath: NPM_GLOBAL_SCRIPT,
        mise: miseDir("npm-n-seiji-nuthatch", "core:node"),
      }),
    );

    expect(method).toEqual({ kind: "npm" });
  });
});

describe("detectInstallMethod: mise のツールディレクトリだがマーカーが読めない場合", () => {
  it("名前が hop のものなら、mise upgrade を案内する unsupported になる (standalone や npm にしない)", () => {
    for (const facts of [
      installFactsOf({
        compiled: true,
        executablePath: `${INSTALLS}/github-n-seiji-nuthatch/0.1.4/hop`,
        mise: miseDir("github-n-seiji-nuthatch", null),
      }),
      installFactsOf({
        scriptPath: `${INSTALLS}/npm-n-seiji-nuthatch/0.1.2/lib/node_modules/@n-seiji/nuthatch/dist/cli.js`,
        mise: miseDir("npm-n-seiji-nuthatch", null),
      }),
    ]) {
      const reason = reasonOf(facts);

      expect(reason).toContain("installed by mise");
      expect(reason).toContain('run "mise upgrade" yourself');
    }
  });

  it("コンパイル済みバイナリは、名前が hop のものでなくても (別名 hop・asdf の installs/nodejs)、バージョンマネージャの install dir 配下として unsupported になる (standalone にしない)", () => {
    for (const name of ["hop", "nodejs"]) {
      const reason = reasonOf(
        installFactsOf({
          compiled: true,
          executablePath: `${INSTALLS}/${name}/0.1.4/hop`,
          mise: miseDir(name, null),
        }),
      );

      expect(reason).toContain("installed under a version manager's install dir");
      expect(reason).toContain(`${INSTALLS}/${name}`);
      expect(reason).toContain("without a readable mise marker");
      expect(reason).toContain("update it with the tool that installed it");
    }
  });

  it("script なら、名前が hop のものでない限り通常どおり他のルールで判定する (asdf の installs/nodejs の npm global など)", () => {
    for (const name of ["nodejs", "hop"]) {
      const method = detectInstallMethod(
        installFactsOf({
          scriptPath: NPM_GLOBAL_SCRIPT,
          mise: miseDir(name, null),
        }),
      );

      expect(method).toEqual({ kind: "npm" });
    }
  });
});

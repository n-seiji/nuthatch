import { rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { detectInstallMethod } from "../domain/install-method.ts";
import {
  createLayoutSandbox,
  createNpmGlobalHop,
  installSourceOf,
  miseBackendToml,
  touch,
} from "../testing/install-layout.ts";
import { type InstallFactsSource, readInstallFacts } from "./install-facts.ts";

/**
 * Facts for installs that sit in a mise tool dir without being a mise install
 * of hop: the tool dir belongs to another tool (hop was put inside a
 * mise-managed node), or its marker cannot be read. What mise installs of hop
 * itself look like is in install-facts-mise.test.ts.
 */

let sandbox: string;

beforeEach(async () => {
  sandbox = await createLayoutSandbox();
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

const installs = (): string => join(sandbox, "mise", "installs");

const methodOf = async (source: InstallFactsSource) =>
  detectInstallMethod(await readInstallFacts(source));

const refusalOf = async (source: InstallFactsSource): Promise<string> => {
  const method = await methodOf(source);
  return method.kind === "unsupported" ? method.reason : `not refused: ${method.kind}`;
};

describe("readInstallFacts: hop のものではない mise のマーカー", () => {
  it("mise の node 配下に npm i -g した場合 (実際の node のマーカー 2 形式)、node のマーカーは無視して npm と判定する", async () => {
    const nodeDir = join(installs(), "node");
    await touch(
      join(nodeDir, ".mise.backend.toml"),
      'short = "node"\nfull = "core:node"\nexplicit_backend = true',
    );
    await touch(join(nodeDir, ".mise.backend"), "node\ncore:node");
    const { script } = await createNpmGlobalHop(join(nodeDir, "25.6.1"));
    await symlink("./25.6.1", join(nodeDir, "25"));

    const facts = await readInstallFacts(
      installSourceOf({ argv1: join(nodeDir, "25", "bin", "hop") }),
    );

    expect(facts.scriptPath).toBe(script);
    expect(facts.mise).toEqual({ dir: nodeDir, backend: "core:node" });
    expect(detectInstallMethod(facts)).toEqual({ kind: "npm" });
  });

  it("別ツール (core:bun) のマーカー配下に置かれたコンパイル済みバイナリも、マーカーは無視して standalone と判定する", async () => {
    const bunDir = join(installs(), "bun");
    await touch(join(bunDir, ".mise.backend.toml"), 'short = "bun"\nfull = "core:bun"\n');
    await touch(join(bunDir, "1.2.0", "bin", "hop"));

    const method = await methodOf(
      installSourceOf({
        compiled: true,
        execPath: join(bunDir, "1.2.0", "bin", "hop"),
      }),
    );

    expect(method.kind).toBe("standalone");
  });

  it("別ツールのマーカーで止まり、その上 (8 階層以内) にある hop 自身のツールディレクトリは見に行かない", async () => {
    /*
     * Hop's own tool dir is within reach above the node dir, but the nearest
     * tool dir is the whole answer: walking on would turn this into `mise`.
     */
    const hopDir = join(installs(), "github-n-seiji-nuthatch");
    await touch(join(hopDir, ".mise.backend.toml"), miseBackendToml("github:n-seiji/nuthatch"));
    const innerNode = join(hopDir, "0.1.4", "installs", "node");
    await touch(join(innerNode, ".mise.backend.toml"), 'short = "node"\nfull = "core:node"\n');
    await touch(join(innerNode, "bin", "hop"));

    const facts = await readInstallFacts(
      installSourceOf({
        compiled: true,
        execPath: join(innerNode, "bin", "hop"),
      }),
    );

    expect(facts.mise).toEqual({ dir: innerNode, backend: "core:node" });
    expect(detectInstallMethod(facts).kind).toBe("standalone");
  });
});

describe("readInstallFacts: マーカーが読めない mise のツールディレクトリ", () => {
  it("名前が hop のものなら、mise upgrade を案内する unsupported にする (standalone や npm にしない)", async () => {
    const binaryDir = join(installs(), "github-n-seiji-nuthatch");
    await touch(join(binaryDir, "0.1.4", "hop"));
    // The leftover on a real machine: only dangling version links, no marker.
    const { bin } = await createNpmGlobalHop(join(installs(), "npm-n-seiji-nuthatch", "0.1.2"));

    const binaryReason = await refusalOf(
      installSourceOf({
        compiled: true,
        execPath: join(binaryDir, "0.1.4", "hop"),
      }),
    );
    const npmReason = await refusalOf(installSourceOf({ argv1: bin }));

    for (const reason of [binaryReason, npmReason]) {
      expect(reason).toContain("installed by mise");
      expect(reason).toContain('run "mise upgrade" yourself');
    }
  });

  it("名前が hop のものでなければ、script はマーカーが無くても無視する (asdf の installs/nodejs の npm global など)", async () => {
    const { bin } = await createNpmGlobalHop(join(installs(), "nodejs", "22.0.0"));

    const method = await methodOf(installSourceOf({ argv1: bin }));

    expect(method).toEqual({ kind: "npm" });
  });

  it("マーカーの無い <tmp>/installs/hop/ (別名) のコンパイル済みバイナリは、standalone にせずバージョンマネージャ配下として unsupported にする", async () => {
    const toolDir = join(sandbox, "installs", "hop");
    await touch(join(toolDir, "0.1.4", "hop"));

    const reason = await refusalOf(
      installSourceOf({
        compiled: true,
        execPath: join(toolDir, "0.1.4", "hop"),
      }),
    );

    expect(reason).toContain("installed under a version manager's install dir");
    expect(reason).toContain(toolDir);
    expect(reason).toContain("update it with the tool that installed it");
  });

  it("マーカーに backend が書かれていない場合も、マーカーが読めないものとして扱う", async () => {
    const toolDir = join(installs(), "github-n-seiji-nuthatch");
    await touch(join(toolDir, ".mise.backend.toml"), 'short = "broken"\n');
    await touch(join(toolDir, "1.0.0", "hop"));
    const source = installSourceOf({
      compiled: true,
      execPath: join(toolDir, "1.0.0", "hop"),
    });

    const facts = await readInstallFacts(source);
    const reason = await refusalOf(source);

    expect(facts.mise).toEqual({ dir: toolDir, backend: null });
    expect(reason).toContain("installed by mise");
  });
});

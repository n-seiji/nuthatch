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
 * Facts for installs under a mise tool dir (`<mise data dir>/installs/<tool>`),
 * laid out the way mise lays them out: both marker formats, the `latest`
 * symlink, and the tools hop merely lives inside (a mise-managed node).
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

describe("readInstallFacts: mise が入れた hop", () => {
  // The real layout: installs/github-n-seiji-nuthatch/{.mise.backend.toml, 0.1.4/hop, latest -> ./0.1.4}
  const githubToolDir = (): string => join(installs(), "github-n-seiji-nuthatch");
  const latestHop = (): string => join(githubToolDir(), "latest", "hop");

  beforeEach(async () => {
    await touch(
      join(githubToolDir(), ".mise.backend.toml"),
      miseBackendToml("github:n-seiji/nuthatch"),
    );
    await touch(join(githubToolDir(), "0.1.4", "hop"));
    await symlink("./0.1.4", join(githubToolDir(), "latest"));
  });

  it("latest シンボリックリンク経由のバイナリの場合、実体のパスとツールディレクトリ・マーカーの backend を返す", async () => {
    const source = installSourceOf({
      compiled: true,
      execPath: latestHop(),
      argv1: "/$bunfs/root/hop",
    });

    const facts = await readInstallFacts(source);

    expect(facts).toEqual({
      compiled: true,
      executablePath: join(githubToolDir(), "0.1.4", "hop"),
      scriptPath: null,
      mise: { dir: githubToolDir(), backend: "github:n-seiji/nuthatch" },
      platform: "darwin",
      arch: "arm64",
    });
  });

  it("その facts は standalone ではなく mise (GitHub) と判定される", async () => {
    const method = await methodOf(installSourceOf({ compiled: true, execPath: latestHop() }));

    expect(method).toEqual({
      kind: "mise",
      tool: "github:n-seiji/nuthatch",
      channel: "github",
    });
  });

  it("mise の npm バックエンド (bin のリンク経由の起動) の場合、スクリプトの実体と npm: の backend を返す", async () => {
    const toolDir = join(installs(), "npm-n-seiji-nuthatch");
    await touch(join(toolDir, ".mise.backend.toml"), miseBackendToml("npm:@n-seiji/nuthatch"));
    const { script, bin } = await createNpmGlobalHop(join(toolDir, "0.1.5"));

    const facts = await readInstallFacts(installSourceOf({ argv1: bin }));

    expect(facts.scriptPath).toBe(script);
    expect(facts.mise).toEqual({
      dir: toolDir,
      backend: "npm:@n-seiji/nuthatch",
    });
    expect(detectInstallMethod(facts)).toEqual({
      kind: "mise",
      tool: "npm:@n-seiji/nuthatch",
      channel: "npm",
    });
  });

  it("マーカーが installs 直下のディレクトリに無い場合、mise のツールディレクトリとは見なさない", async () => {
    const toolDir = join(sandbox, "elsewhere", "github-n-seiji-nuthatch");
    await touch(join(toolDir, ".mise.backend.toml"), miseBackendToml("github:n-seiji/nuthatch"));
    await touch(join(toolDir, "0.1.4", "hop"));

    const facts = await readInstallFacts(
      installSourceOf({
        compiled: true,
        execPath: join(toolDir, "0.1.4", "hop"),
      }),
    );

    expect(facts.mise).toBeNull();
    expect(detectInstallMethod(facts).kind).toBe("standalone");
  });
});

describe("readInstallFacts: 旧形式の .mise.backend", () => {
  it("旧形式だけの npm バックエンド (2 行とも同じ id) も mise と判定する", async () => {
    const toolDir = join(installs(), "npm-n-seiji-nuthatch");
    await touch(join(toolDir, ".mise.backend"), "npm:@n-seiji/nuthatch\nnpm:@n-seiji/nuthatch");
    const { bin } = await createNpmGlobalHop(join(toolDir, "0.1.5"));

    const facts = await readInstallFacts(installSourceOf({ argv1: bin }));

    expect(facts.mise).toEqual({
      dir: toolDir,
      backend: "npm:@n-seiji/nuthatch",
    });
    expect(detectInstallMethod(facts)).toEqual({
      kind: "mise",
      tool: "npm:@n-seiji/nuthatch",
      channel: "npm",
    });
  });

  it("1 行目は short 名で 2 行目が full: hop を別名 (hop) で入れた場合も full で mise と判定する", async () => {
    const toolDir = join(installs(), "hop");
    await touch(join(toolDir, ".mise.backend"), "hop\ngithub:n-seiji/nuthatch\n");
    await touch(join(toolDir, "0.1.4", "hop"));

    const method = await methodOf(
      installSourceOf({
        compiled: true,
        execPath: join(toolDir, "0.1.4", "hop"),
      }),
    );

    expect(method).toEqual({
      kind: "mise",
      tool: "github:n-seiji/nuthatch",
      channel: "github",
    });
  });

  it("toml が読めない形式なら旧形式にフォールバックする", async () => {
    const toolDir = join(installs(), "github-n-seiji-nuthatch");
    await touch(join(toolDir, ".mise.backend.toml"), "garbage\n");
    await touch(join(toolDir, ".mise.backend"), "github:n-seiji/nuthatch\ngithub:n-seiji/nuthatch");
    await touch(join(toolDir, "0.1.4", "hop"));

    const method = await methodOf(
      installSourceOf({
        compiled: true,
        execPath: join(toolDir, "0.1.4", "hop"),
      }),
    );

    expect(method).toMatchObject({
      kind: "mise",
      tool: "github:n-seiji/nuthatch",
    });
  });

  it("両方の形式がある場合は toml を優先する", async () => {
    const toolDir = join(installs(), "ubi-n-seiji-nuthatch");
    await touch(
      join(toolDir, ".mise.backend.toml"),
      'short = "x"\nfull = "ubi:n-seiji/nuthatch"\n',
    );
    await touch(join(toolDir, ".mise.backend"), "x\ncore:node");
    await touch(join(toolDir, "0.1.4", "hop"));

    const method = await methodOf(
      installSourceOf({
        compiled: true,
        execPath: join(toolDir, "0.1.4", "hop"),
      }),
    );

    expect(method).toMatchObject({
      kind: "mise",
      tool: "ubi:n-seiji/nuthatch",
    });
  });
});

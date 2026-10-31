import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { type InstallFactsSource, readInstallFacts } from "./install-facts.ts";

let sandbox: string;

beforeEach(async () => {
  const created = await mkdtemp(join(tmpdir(), "nuthatch-install-facts-"));
  sandbox = await realpath(created);
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

const sourceOf = (overrides: Partial<InstallFactsSource>): InstallFactsSource => ({
  compiled: false,
  execPath: "/usr/bin/node",
  argv1: undefined,
  platform: "darwin",
  arch: "arm64",
  ...overrides,
});

describe("readInstallFacts", () => {
  it("コンパイル済みバイナリの場合、symlink を辿った実体のパスを executablePath に返す", async () => {
    const real = join(sandbox, "real", "hop");
    await mkdir(join(sandbox, "real"));
    await writeFile(real, "");
    await symlink(real, join(sandbox, "hop"));

    const facts = await readInstallFacts(
      sourceOf({ compiled: true, execPath: join(sandbox, "hop") }),
    );

    expect(facts).toEqual({
      compiled: true,
      executablePath: real,
      scriptPath: null,
      platform: "darwin",
      arch: "arm64",
    });
  });

  it("スクリプトの場合、npm bin の symlink を辿った実体のパスを scriptPath に返す", async () => {
    const script = join(sandbox, "lib", "cli.js");
    await mkdir(join(sandbox, "lib"));
    await writeFile(script, "");
    await symlink(script, join(sandbox, "hop"));

    const facts = await readInstallFacts(sourceOf({ argv1: join(sandbox, "hop") }));

    expect(facts).toMatchObject({
      compiled: false,
      executablePath: null,
      scriptPath: script,
    });
  });

  it("解決できないパスの場合、書かれたままのパスを返す", async () => {
    const facts = await readInstallFacts(sourceOf({ argv1: join(sandbox, "missing.js") }));

    expect(facts.scriptPath).toBe(join(sandbox, "missing.js"));
  });
});

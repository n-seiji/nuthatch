import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMcpInstallPort } from "./mcp-install.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nuthatch-mcp-install-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const portFor = () => createMcpInstallPort(dir, { XDG_CONFIG_HOME: join(dir, "xdg") });

describe("createMcpInstallPort", () => {
  it("XDG_CONFIG_HOME がなければ ~/.config/opencode", async () => {
    expect(await createMcpInstallPort(dir, {}).configPath("opencode")).toBe(
      join(dir, ".config", "opencode", "opencode.json"),
    );
  });

  it("cursor は ~/.cursor/mcp.json、opencode は XDG_CONFIG_HOME 配下", async () => {
    const port = portFor();
    expect(await port.configPath("cursor")).toBe(join(dir, ".cursor", "mcp.json"));
    expect(await port.configPath("opencode")).toBe(join(dir, "xdg", "opencode", "opencode.json"));
  });

  it("opencode.jsonc しかなければそれを返す", async () => {
    await mkdir(join(dir, "xdg", "opencode"), { recursive: true });
    await writeFile(join(dir, "xdg", "opencode", "opencode.jsonc"), "{}");
    expect(await portFor().configPath("opencode")).toBe(
      join(dir, "xdg", "opencode", "opencode.jsonc"),
    );
  });

  it("書き込みは親ディレクトリを作り、所有者だけが読める", async () => {
    const port = portFor();
    const path = join(dir, "a", "b", "mcp.json");

    expect(await port.readTextFile(path)).toBeNull();
    await port.writeTextFile(path, "{}\n");

    expect(await readFile(path, "utf8")).toBe("{}\n");
    const { mode } = await stat(path);
    // oxlint-disable-next-line no-bitwise
    expect(mode & 0o777).toBe(0o600);
  });
});

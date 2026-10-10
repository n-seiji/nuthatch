import { describe, expect, it } from "bun:test";
import type { CommandArgv } from "../domain/install-method.ts";
import type { McpInstallPort } from "../domain/ports.ts";
import { mcpConfig, mcpInstall } from "./mcp-install.ts";

interface FakePort extends McpInstallPort {
  readonly ran: CommandArgv[];
  readonly files: Map<string, string>;
}

const fakePort = (
  onPath: Readonly<Record<string, string>>,
  { exitCode = 0, files = {} }: { exitCode?: number; files?: Record<string, string> } = {},
): FakePort => {
  const ran: CommandArgv[] = [];
  const fileMap = new Map(Object.entries(files));
  return {
    ran,
    files: fileMap,
    resolveExecutable: (name) => Promise.resolve(onPath[name] ?? null),
    runCommand: (argv) => {
      ran.push(argv);
      return Promise.resolve(exitCode);
    },
    configPath: (client) =>
      Promise.resolve(
        client === "cursor" ? "/h/.cursor/mcp.json" : "/h/.config/opencode/opencode.json",
      ),
    readTextFile: (path) => Promise.resolve(fileMap.get(path) ?? null),
    writeTextFile: (path, text) => {
      fileMap.set(path, text);
      return Promise.resolve();
    },
  };
};

describe("mcpInstall (cli clients)", () => {
  it("client の mcp add を、PATH 上の hop の絶対パスで実行する", async () => {
    const port = fakePort({ claude: "/bin/claude", hop: "/home/u/.local/bin/hop" });

    const result = await mcpInstall(port, { client: "claude", dryRun: false });

    expect(result.ok).toBe(true);
    expect(port.ran).toEqual([
      [
        "/bin/claude",
        "mcp",
        "add",
        "--scope",
        "user",
        "hop",
        "--",
        "/home/u/.local/bin/hop",
        "mcp",
      ],
    ]);
    expect(result.data).toMatchObject({
      client: "claude",
      method: "cli",
      configPath: null,
      ran: true,
    });
  });

  it("--dry-run は何も実行せず、実行するコマンドだけを返す", async () => {
    const port = fakePort({ codex: "/bin/codex" });

    const result = await mcpInstall(port, { client: "codex", dryRun: true });

    expect(port.ran).toEqual([]);
    expect(result.data).toEqual({
      client: "codex",
      method: "cli",
      command: ["/bin/codex", "mcp", "add", "hop", "--", "hop", "mcp"],
      configPath: null,
      ran: false,
    });
  });

  it("client が PATH にないと exit 1 で、手動設定の方法を案内する", async () => {
    const result = await mcpInstall(fakePort({}), { client: "codex", dryRun: false });

    expect(result.exitCode).toBe(1);
    expect(result.errorMessage).toContain("hop mcp config");
  });

  it("client の mcp add が失敗したら exit 1", async () => {
    const port = fakePort({ claude: "/bin/claude" }, { exitCode: 1 });

    const result = await mcpInstall(port, { client: "claude", dryRun: false });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
  });
});

describe("mcpInstall (file clients)", () => {
  it("cursor: 設定ファイルがなければ作り、mcpServers.hop を書く", async () => {
    const port = fakePort({ hop: "/usr/local/bin/hop" });

    const result = await mcpInstall(port, { client: "cursor", dryRun: false });

    expect(result.data).toEqual({
      client: "cursor",
      method: "file",
      command: null,
      configPath: "/h/.cursor/mcp.json",
      ran: true,
    });
    expect(JSON.parse(port.files.get("/h/.cursor/mcp.json") ?? "")).toEqual({
      mcpServers: { hop: { command: "/usr/local/bin/hop", args: ["mcp"] } },
    });
  });

  it("opencode: 既存の設定を残したまま mcp.hop を足す", async () => {
    const path = "/h/.config/opencode/opencode.json";
    const port = fakePort(
      {},
      { files: { [path]: '{"theme":"dark","mcp":{"other":{"type":"remote","url":"https://x"}}}' } },
    );

    const result = await mcpInstall(port, { client: "opencode", dryRun: false });

    expect(result.ok).toBe(true);
    expect(JSON.parse(port.files.get(path) ?? "")).toEqual({
      theme: "dark",
      mcp: {
        other: { type: "remote", url: "https://x" },
        hop: { type: "local", command: ["hop", "mcp"], enabled: true },
      },
    });
  });

  it("--dry-run はファイルを書かない", async () => {
    const port = fakePort({});

    const result = await mcpInstall(port, { client: "cursor", dryRun: true });

    expect(result.data?.ran).toBe(false);
    expect(port.files.size).toBe(0);
  });

  it("同じ内容で登録済みなら書かずに成功し、警告を出す", async () => {
    const path = "/h/.cursor/mcp.json";
    const port = fakePort(
      {},
      { files: { [path]: '{"mcpServers":{"hop":{"command":"hop","args":["mcp"]}}}' } },
    );

    const result = await mcpInstall(port, { client: "cursor", dryRun: false });

    expect(result.ok).toBe(true);
    expect(result.data?.ran).toBe(false);
    expect(result.warnings?.[0]).toContain("already registered");
  });

  it("書き換えられないファイルは触らず exit 1", async () => {
    const path = "/h/.config/opencode/opencode.json";
    const original = '{\n  // comment\n  "mcp": {}\n}\n';
    const port = fakePort({}, { files: { [path]: original } });

    const result = await mcpInstall(port, { client: "opencode", dryRun: false });

    expect(result.exitCode).toBe(1);
    expect(result.errorMessage).toContain("hop mcp config");
    expect(port.files.get(path)).toBe(original);
  });
});

describe("mcpConfig", () => {
  it("hop の絶対パスで mcpServers エントリを返す", async () => {
    const result = await mcpConfig(fakePort({ hop: "/usr/local/bin/hop" }));

    expect(result.data).toEqual({
      mcpServers: { hop: { command: "/usr/local/bin/hop", args: ["mcp"] } },
    });
  });
});

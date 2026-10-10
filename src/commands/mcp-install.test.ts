import { describe, expect, it } from "bun:test";
import type { CommandArgv } from "../domain/install-method.ts";
import type { McpInstallPort } from "../domain/ports.ts";
import { mcpConfig, mcpInstall } from "./mcp-install.ts";

const fakePort = (
  onPath: Readonly<Record<string, string>>,
  exitCode = 0,
): McpInstallPort & { readonly ran: CommandArgv[] } => {
  const ran: CommandArgv[] = [];
  return {
    ran,
    resolveExecutable: (name) => Promise.resolve(onPath[name] ?? null),
    runCommand: (argv) => {
      ran.push(argv);
      return Promise.resolve(exitCode);
    },
  };
};

describe("mcpInstall", () => {
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
    expect(result.data).toMatchObject({ client: "claude", ran: true });
  });

  it("--dry-run は何も実行せず、実行するコマンドだけを返す", async () => {
    const port = fakePort({ codex: "/bin/codex" });

    const result = await mcpInstall(port, { client: "codex", dryRun: true });

    expect(port.ran).toEqual([]);
    expect(result.data).toEqual({
      client: "codex",
      command: ["/bin/codex", "mcp", "add", "hop", "--", "hop", "mcp"],
      ran: false,
    });
  });

  it("client が PATH にないと exit 1 で、手動設定の方法を案内する", async () => {
    const result = await mcpInstall(fakePort({}), { client: "codex", dryRun: false });

    expect(result.exitCode).toBe(1);
    expect(result.errorMessage).toContain("hop mcp config");
  });

  it("client の mcp add が失敗したら exit 1", async () => {
    const port = fakePort({ claude: "/bin/claude" }, 1);

    const result = await mcpInstall(port, { client: "claude", dryRun: false });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
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

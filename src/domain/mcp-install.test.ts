import { describe, expect, it } from "bun:test";
import { isMcpClient, mcpInstallArgv, mcpServerConfig, mergeMcpConfig } from "./mcp-install.ts";

describe("mcpInstallArgv", () => {
  it("Claude Code にはユーザースコープで hop mcp を登録する", () => {
    expect(mcpInstallArgv("claude", "/bin/claude", "/home/u/.local/bin/hop")).toEqual([
      "/bin/claude",
      "mcp",
      "add",
      "--scope",
      "user",
      "hop",
      "--",
      "/home/u/.local/bin/hop",
      "mcp",
    ]);
  });

  it("Codex には codex mcp add で登録する", () => {
    expect(mcpInstallArgv("codex", "/bin/codex", "hop")).toEqual([
      "/bin/codex",
      "mcp",
      "add",
      "hop",
      "--",
      "hop",
      "mcp",
    ]);
  });
});

describe("mcpServerConfig", () => {
  it("mcpServers.hop に command と args を入れる", () => {
    expect(mcpServerConfig("hop")).toEqual({
      mcpServers: { hop: { command: "hop", args: ["mcp"] } },
    });
  });
});

describe("isMcpClient", () => {
  it("claude・codex・cursor・opencode だけを受け付ける", () => {
    for (const client of ["claude", "codex", "cursor", "opencode"]) {
      expect(isMcpClient(client)).toBe(true);
    }
    expect(isMcpClient("vscode")).toBe(false);
  });
});

describe("mergeMcpConfig", () => {
  it("ファイルがなければ hop だけの設定を作る", () => {
    const merge = mergeMcpConfig("cursor", null, "hop");
    expect(merge.kind).toBe("write");
    expect(merge.kind === "write" && JSON.parse(merge.text)).toEqual({
      mcpServers: { hop: { command: "hop", args: ["mcp"] } },
    });
  });

  it("ほかのキーとサーバーは残す", () => {
    const merge = mergeMcpConfig(
      "opencode",
      '{"model":"x","mcp":{"a":{"type":"local"}}}',
      "/bin/hop",
    );
    expect(merge.kind === "write" && JSON.parse(merge.text)).toEqual({
      model: "x",
      mcp: {
        a: { type: "local" },
        hop: { type: "local", command: ["/bin/hop", "mcp"], enabled: true },
      },
    });
  });

  it("同じ hop エントリがあれば unchanged", () => {
    expect(
      mergeMcpConfig("cursor", '{"mcpServers":{"hop":{"command":"hop","args":["mcp"]}}}', "hop"),
    ).toEqual({
      kind: "unchanged",
    });
  });

  it("違う hop エントリ・JSON でないもの・オブジェクトでない servers は拒否する", () => {
    for (const text of [
      '{"mcpServers":{"hop":{"command":"other"}}}',
      "// comment\n{}",
      "[]",
      '{"mcpServers":[]}',
    ]) {
      expect(mergeMcpConfig("cursor", text, "hop").kind).toBe("refuse");
    }
  });
});

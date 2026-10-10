import { describe, expect, it } from "bun:test";
import { isMcpClient, mcpInstallArgv, mcpServerConfig } from "./mcp-install.ts";

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
  it("claude と codex だけを受け付ける", () => {
    expect(isMcpClient("claude")).toBe(true);
    expect(isMcpClient("codex")).toBe(true);
    expect(isMcpClient("cursor")).toBe(false);
  });
});

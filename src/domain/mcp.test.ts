import { describe, expect, it } from "bun:test";
import {
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_METHOD_NOT_FOUND,
  LATEST_PROTOCOL_VERSION,
  MCP_TOOLS,
  McpToolArgsSchemas,
  handleMcpMessage,
  toolResult,
} from "./mcp.ts";

const request = (method: string, params?: unknown, id: number | string = 1) => ({
  jsonrpc: "2.0",
  id,
  method,
  ...(params === undefined ? {} : { params }),
});

describe("handleMcpMessage", () => {
  it("initialize: 対応している版はそのまま返し、tools capability と serverInfo を返す", () => {
    const action = handleMcpMessage(
      request("initialize", { protocolVersion: "2025-06-18" }),
      "1.2.3",
    );
    expect(action).toMatchObject({
      kind: "respond",
      response: {
        id: 1,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "hop", version: "1.2.3" },
        },
      },
    });
  });

  it("initialize: 知らない版を要求されたら最新版を返す", () => {
    const action = handleMcpMessage(request("initialize", { protocolVersion: "1999-01-01" }), "0");
    expect(action).toMatchObject({
      response: { result: { protocolVersion: LATEST_PROTOCOL_VERSION } },
    });
  });

  it("通知 (id なし) には応答しない", () => {
    expect(handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, "0")).toEqual({
      kind: "ignore",
    });
  });

  it("クライアントからの response は無視する", () => {
    expect(handleMcpMessage({ jsonrpc: "2.0", id: 5, result: {} }, "0")).toEqual({
      kind: "ignore",
    });
  });

  it("ping には空の result を返す", () => {
    expect(handleMcpMessage(request("ping", undefined, "a"), "0")).toEqual({
      kind: "respond",
      response: { jsonrpc: "2.0", id: "a", result: {} },
    });
  });

  it("tools/list は読み取り専用ツールだけを返す", () => {
    const action = handleMcpMessage(request("tools/list"), "0");
    expect(action).toMatchObject({ response: { result: { tools: MCP_TOOLS } } });
    for (const tool of MCP_TOOLS) {
      expect(tool.annotations.readOnlyHint).toBe(true);
      expect(tool.annotations.destructiveHint).toBe(false);
    }
  });

  it("tools/call は引数を検証してツール呼び出しにする", () => {
    const action = handleMcpMessage(
      request("tools/call", {
        name: "worktree_status",
        arguments: { cwd: "/repo", branch: "feat/x" },
      }),
      "0",
    );
    expect(action).toEqual({
      kind: "callTool",
      id: 1,
      call: { name: "worktree_status", args: { cwd: "/repo", branch: "feat/x" } },
    });
  });

  it("tools/call: arguments を省略してもよい", () => {
    expect(handleMcpMessage(request("tools/call", { name: "list_worktrees" }), "0")).toEqual({
      kind: "callTool",
      id: 1,
      call: { name: "list_worktrees", args: {} },
    });
  });

  it("tools/call: 相対パスの cwd は invalid params", () => {
    const action = handleMcpMessage(
      request("tools/call", { name: "list_worktrees", arguments: { cwd: "repo" } }),
      "0",
    );
    expect(action).toMatchObject({ response: { error: { code: JSON_RPC_INVALID_PARAMS } } });
  });

  it("tools/call: 存在しないツールや prototype のキーは invalid params", () => {
    for (const name of ["remove_worktree", "toString", "__proto__"]) {
      const action = handleMcpMessage(request("tools/call", { name }), "0");
      expect(action).toMatchObject({ response: { error: { code: JSON_RPC_INVALID_PARAMS } } });
    }
  });

  it("知らないメソッドは method not found", () => {
    expect(handleMcpMessage(request("resources/list"), "0")).toMatchObject({
      response: { id: 1, error: { code: JSON_RPC_METHOD_NOT_FOUND } },
    });
  });

  it("JSON-RPC として不正なものは invalid request", () => {
    for (const message of [[], "x", { id: 1, method: "ping" }, { jsonrpc: "2.0", id: 2 }]) {
      expect(handleMcpMessage(message, "0")).toMatchObject({
        response: { error: { code: JSON_RPC_INVALID_REQUEST } },
      });
    }
  });
});

describe("MCP_TOOLS", () => {
  it("各ツールの inputSchema のプロパティは引数スキーマと一致する", () => {
    for (const tool of MCP_TOOLS) {
      expect(Object.keys(tool.inputSchema.properties).toSorted()).toEqual(
        Object.keys(McpToolArgsSchemas[tool.name].entries).toSorted(),
      );
    }
  });
});

describe("toolResult", () => {
  it("envelope を structuredContent と text の両方で返す", () => {
    const envelope = { schemaVersion: 1, command: "ls", data: [], warnings: [] };
    expect(toolResult(3, envelope, false)).toEqual({
      jsonrpc: "2.0",
      id: 3,
      result: {
        content: [{ type: "text", text: JSON.stringify(envelope) }],
        structuredContent: envelope,
        isError: false,
      },
    });
  });

  it("失敗したらエラーメッセージも text で添えて isError にする", () => {
    const envelope = { schemaVersion: 1, command: "status", warnings: [] };
    expect(toolResult(3, envelope, true, "No worktree found")).toMatchObject({
      result: {
        content: [{ type: "text" }, { type: "text", text: "No worktree found" }],
        isError: true,
      },
    });
  });
});

import { describe, expect, it } from "bun:test";
import { safeParse } from "valibot";
import { JumpEnvelopeSchema, LsEnvelopeSchema, RmEnvelopeSchema } from "./schema.ts";

describe("JSON envelope schemas", () => {
  it("LsEnvelopeSchema は data 省略時も warnings があれば成功する", () => {
    const result = safeParse(LsEnvelopeSchema, {
      schemaVersion: 1,
      command: "ls",
      warnings: ["something"],
    });
    expect(result.success).toBe(true);
  });

  it("schemaVersion が 1 以外だと失敗する", () => {
    const result = safeParse(JumpEnvelopeSchema, {
      schemaVersion: 2,
      command: "jump",
      data: { branch: "main", created: false },
      warnings: [],
    });
    expect(result.success).toBe(false);
  });

  it("data の形が一致しないと失敗する", () => {
    const result = safeParse(RmEnvelopeSchema, {
      schemaVersion: 1,
      command: "rm",
      data: { branch: "main" }, // Missing `path`
      warnings: [],
    });
    expect(result.success).toBe(false);
  });
});

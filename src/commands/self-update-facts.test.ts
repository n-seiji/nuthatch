import { describe, expect, it } from "bun:test";
import { EXIT_GENERAL_ERROR } from "../domain/result.ts";
import { createFakeSelfUpdate } from "../testing/self-update-port.ts";
import { selfUpdate } from "./self-update.ts";

describe("selfUpdate: インストール情報を読めない場合", () => {
  it("読み取りに失敗した場合、例外にせず原因を含めて exit 1 になり、それ以上は何もしない", async () => {
    const fake = createFakeSelfUpdate({
      installFacts: () => Promise.reject(new Error("EACCES: permission denied, realpath '/x/hop'")),
    });

    const result = await selfUpdate(fake.port, fake.term, {
      currentVersion: "0.1.4",
      check: false,
    });

    expect(result).toMatchObject({ ok: false, exitCode: EXIT_GENERAL_ERROR });
    expect(result.errorMessage).toStartWith("Cannot update hop: ");
    expect(result.errorMessage).toContain("EACCES: permission denied, realpath '/x/hop'");
    expect(result.data).toBeUndefined();
    expect(fake.calls).toEqual(["installFacts"]);
  });
});

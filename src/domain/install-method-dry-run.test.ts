import { describe, expect, it } from "bun:test";
import { miseDryRunCommand, upgradeCommand } from "./install-method.ts";

describe("miseDryRunCommand", () => {
  it("何も変更せず、upgrade が何かを動かすかを終了コードで答える mise upgrade --dry-run-code <tool> を返す", () => {
    const method = { kind: "mise", tool: "github:n-seiji/nuthatch", channel: "github" } as const;

    expect(miseDryRunCommand(method)).toEqual([
      "mise",
      "upgrade",
      "--dry-run-code",
      "github:n-seiji/nuthatch",
    ]);
  });

  it("mise upgrade と同じツールを指す (問い合わせと実行で対象がずれない)", () => {
    const method = { kind: "mise", tool: "npm:@n-seiji/nuthatch", channel: "npm" } as const;

    expect(miseDryRunCommand(method).at(-1)).toBe(upgradeCommand(method).at(-1));
  });
});

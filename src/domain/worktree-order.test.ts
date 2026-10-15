import { describe, expect, it } from "bun:test";
import { compareWorktrees } from "./worktree-order.ts";

describe("compareWorktrees", () => {
  it("orders root → managed → external, branch ascending, detached last within a kind", () => {
    const sorted = [
      { kind: "external", branch: "a" },
      { kind: "managed", branch: null },
      { kind: "managed", branch: "zeta" },
      { kind: "root", branch: "main" },
      { kind: "managed", branch: "alpha" },
    ] as const;
    expect(sorted.toSorted(compareWorktrees)).toEqual([
      { kind: "root", branch: "main" },
      { kind: "managed", branch: "alpha" },
      { kind: "managed", branch: "zeta" },
      { kind: "managed", branch: null },
      { kind: "external", branch: "a" },
    ]);
  });

  it("ties two detached worktrees of the same kind", () => {
    expect(
      compareWorktrees({ kind: "managed", branch: null }, { kind: "managed", branch: null }),
    ).toBe(0);
  });
});

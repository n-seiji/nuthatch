import { describe, expect, it } from "bun:test";
import { type PickCandidate } from "../domain/candidates.ts";
import { buildDisplayRows, displayRowKey } from "./picker-layout.ts";

const detachedCandidate = (path: string): PickCandidate => ({
  kind: "worktree",
  worktree: {
    path,
    head: "abc123",
    branch: null,
    detached: true,
    bare: false,
    locked: false,
    lockReason: null,
    prunable: false,
    prunableReason: null,
    kind: "external",
  },
  dirty: null,
});

describe("picker row keys", () => {
  it("同じ (detached) label の行でも candidate index が異なれば衝突しない", () => {
    const candidates = [detachedCandidate("/repo/a"), detachedCandidate("/repo/b")];
    const [first, second] = buildDisplayRows(candidates, "/repo").filter(
      (row) => row.kind === "candidate",
    );

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) {
      throw new Error("unreachable: asserted above");
    }
    expect(displayRowKey(first)).not.toBe(displayRowKey(second));
  });
});

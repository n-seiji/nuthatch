import { describe, expect, it } from "bun:test";
import { type PickCandidate } from "../domain/candidates.ts";
import { candidateRowKey } from "./picker.tsx";

const detachedCandidate = (): PickCandidate => ({
  kind: "worktree",
  worktree: {
    path: "/repo/detached",
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
  it("同じ (detached) label の行でも index を含めて衝突しない", () => {
    const candidate = detachedCandidate();

    expect(candidateRowKey(candidate, 0)).not.toBe(candidateRowKey(candidate, 1));
  });
});

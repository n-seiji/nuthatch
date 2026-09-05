import { describe, expect, it } from "bun:test";
import type { PickCandidate } from "../domain/candidates.ts";
import type { Worktree } from "../domain/model.ts";
import { panelErrorTransition } from "./picker-controller.ts";

const worktree = (overrides: Partial<Worktree> = {}): Worktree => ({
  path: "/repo",
  head: "abc",
  branch: "main",
  detached: false,
  bare: false,
  locked: false,
  lockReason: null,
  prunable: false,
  prunableReason: null,
  kind: "root",
  ...overrides,
});

const managedCandidate: PickCandidate = {
  kind: "worktree",
  worktree: worktree({ kind: "managed", branch: "feat/a" }),
  dirty: null,
};

const externalCandidate: PickCandidate = {
  kind: "worktree",
  worktree: worktree({ kind: "external", branch: "feat/b" }),
  dirty: null,
};

describe("panelErrorTransition", () => {
  it("panelIndex を常に 0 にリセットする (astra P2 regression)", () => {
    // Bug scenario (astra P2): panel opened on a managed worktree (3 actions: cd/delete/switchRoot), highlight moved to index 2 (switchRoot), Esc back to the list, then a different candidate with only 2 actions (cd/switchRoot — e.g. external) triggers Ctrl+R and it fails (dirty rejection). Without resetting panelIndex, the stale index 2 survives into a 2-item action list: nothing is highlighted, but Enter still clamps to the last action and re-runs switchRoot — display and execution target disagree. panelErrorTransition must always return 0 regardless of the candidate or the panelIndex the caller had before.
    const transition = panelErrorTransition(externalCandidate, "dirty, refusing");
    expect(transition.panelIndex).toBe(0);
    expect(transition.mode).toEqual({
      kind: "panel",
      candidate: externalCandidate,
      error: "dirty, refusing",
    });
  });

  it("candidate や error message が変わっても panelIndex は常に 0", () => {
    expect(panelErrorTransition(managedCandidate, "some other error").panelIndex).toBe(0);
  });
});

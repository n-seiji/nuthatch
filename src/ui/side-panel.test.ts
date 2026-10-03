import { describe, expect, it } from "bun:test";
import type { PickCandidate } from "../domain/candidates.ts";
import type { Worktree } from "../domain/model.ts";
import { buildConfirmPanelRows } from "./side-panel.ts";

const worktreeCandidate = (overrides: Partial<Worktree> = {}): PickCandidate => ({
  kind: "worktree",
  worktree: {
    path: "/repo/wt",
    head: "abc",
    branch: "feat/a",
    detached: false,
    bare: false,
    locked: false,
    lockReason: null,
    prunable: false,
    prunableReason: null,
    kind: "managed",
    ...overrides,
  },
  dirty: null,
});

const prunableCandidate = (): PickCandidate =>
  worktreeCandidate({
    prunable: true,
    prunableReason: "gitdir file points to non-existent location",
  });

describe("buildConfirmPanelRows", () => {
  it("prunable な worktree を delete する場合、質問の下に登録だけが消える旨を dim で添える", () => {
    const rows = buildConfirmPanelRows({
      candidate: prunableCandidate(),
      action: "delete",
    });

    expect(rows).toEqual([
      [{ text: "Delete worktree for " }, { text: "feat/a", style: "cyan" }, { text: "?" }],
      [{ text: "Directory gone: removing only", style: "dim" }],
      [{ text: "its stale registration.", style: "dim" }],
      [{ text: "(y/N)", style: "dim" }],
    ]);
  });

  it("通常の worktree を delete する場合、質問と (y/N) だけの 2 行になる", () => {
    const rows = buildConfirmPanelRows({
      candidate: worktreeCandidate(),
      action: "delete",
    });

    expect(rows).toEqual([
      [{ text: "Delete worktree for " }, { text: "feat/a", style: "cyan" }, { text: "?" }],
      [{ text: "(y/N)", style: "dim" }],
    ]);
  });

  it("prunable な worktree でも switchRoot の場合、登録削除の注記は付かず detached HEAD の注記だけになる", () => {
    const rows = buildConfirmPanelRows({
      candidate: prunableCandidate(),
      action: "switchRoot",
    });

    expect(rows).toEqual([
      [{ text: "Switch root here for " }, { text: "feat/a", style: "cyan" }, { text: "?" }],
      [{ text: "This will put it into detached HEAD.", style: "dim" }],
      [{ text: "(y/N)", style: "dim" }],
    ]);
  });
});

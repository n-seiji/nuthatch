import { describe, expect, it, mock } from "bun:test";
import type { Worktree } from "../domain/model.ts";
import type { PickCandidate } from "../domain/candidates.ts";
import { handlePanelInput } from "./picker-input.ts";
import type { PickerKeyModifiers } from "./picker-keys.ts";
import type { PickerMode } from "./picker-types.ts";

const noMods: PickerKeyModifiers = {
  ctrl: false,
  meta: false,
  escape: false,
  return: false,
  tab: false,
  upArrow: false,
  downArrow: false,
  leftArrow: false,
  rightArrow: false,
  backspace: false,
  delete: false,
};
const enterKey: PickerKeyModifiers = { ...noMods, return: true };

const worktree = (overrides: Partial<Worktree> = {}): Worktree => ({
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
});

const worktreeCandidate = (overrides: Partial<Worktree> = {}): PickCandidate => ({
  kind: "worktree",
  worktree: worktree(overrides),
  dirty: false,
});

describe("handlePanelInput — delete confirmation gating", () => {
  it("managed worktree: panel Enter on delete runs the mutation immediately (no confirm overlay)", () => {
    const candidate = worktreeCandidate({ kind: "managed" });
    const runAction = mock(() => {});
    const setMode = mock((_mode: PickerMode) => {});
    const panelMode = { kind: "panel" as const, candidate, error: null };

    // Panel order is [cd, delete, switchRoot] for managed — index 1 is delete.
    handlePanelInput("\r", enterKey, panelMode, {
      panelIndex: 1,
      runAction,
      setPanelIndex: () => {},
      setMode,
    });

    expect(runAction).toHaveBeenCalledWith(candidate, "delete");
    expect(setMode).not.toHaveBeenCalled();
  });

  it("external worktree: panel Enter on delete opens the y/N confirm overlay instead of running", () => {
    const candidate = worktreeCandidate({ kind: "external" });
    const runAction = mock(() => {});
    const setMode = mock((_mode: PickerMode) => {});
    const panelMode = { kind: "panel" as const, candidate, error: null };

    // Panel order is [cd, delete, switchRoot] for external too (delete is now offered).
    handlePanelInput("\r", enterKey, panelMode, {
      panelIndex: 1,
      runAction,
      setPanelIndex: () => {},
      setMode,
    });

    expect(runAction).not.toHaveBeenCalled();
    expect(setMode).toHaveBeenCalledWith({
      kind: "confirmDelete",
      candidate,
      error: null,
    });
  });

  it("external worktree: letter shortcut ('d') for delete also opens the confirm overlay", () => {
    const candidate = worktreeCandidate({ kind: "external" });
    const runAction = mock(() => {});
    const setMode = mock((_mode: PickerMode) => {});
    const panelMode = { kind: "panel" as const, candidate, error: null };

    handlePanelInput("d", noMods, panelMode, {
      panelIndex: 0,
      runAction,
      setPanelIndex: () => {},
      setMode,
    });

    expect(runAction).not.toHaveBeenCalled();
    expect(setMode).toHaveBeenCalledWith({
      kind: "confirmDelete",
      candidate,
      error: null,
    });
  });
});

import { describe, expect, it } from "bun:test";
import type { PickCandidate } from "../domain/candidates.ts";
import type { Worktree } from "../domain/model.ts";
import { createPickerStore, panelErrorTransition } from "./picker-store.ts";
import type { PickerCallbacks } from "./picker-types.ts";
import type { PickerKeyModifiers } from "./picker-keys.ts";

const NO_MODIFIERS: PickerKeyModifiers = {
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

const noopCallbacks = (overrides: Partial<PickerCallbacks> = {}): PickerCallbacks => ({
  deleteWorktree: () => Promise.resolve({ ok: true }),
  switchRootHere: () => Promise.resolve({ ok: true, path: "/root" }),
  reloadCandidates: () => Promise.resolve([]),
  ...overrides,
});

const openPanel = (store: ReturnType<typeof createPickerStore>): void => {
  store.handleInput("", { ...NO_MODIFIERS, tab: true });
};

const flush = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

describe("createPickerStore", () => {
  it("busy 中に来た入力は無視する (二重実行防止)", async () => {
    let resolveDelete: (() => void) | undefined;
    const deleteWorktree: PickerCallbacks["deleteWorktree"] = () =>
      new Promise((resolve) => {
        resolveDelete = () => resolve({ ok: true });
      });
    const store = createPickerStore(
      [managedCandidate],
      noopCallbacks({ deleteWorktree }),
      () => {},
      () => {},
    );

    openPanel(store);
    expect(store.getSnapshot().mode.kind).toBe("panel");

    // "D" (delete shortcut letter) triggers the mutation and flips busy.
    store.handleInput("d", NO_MODIFIERS);
    expect(store.getSnapshot().busy).toBe(true);

    // Further input while busy must not reopen/close panels or move selection.
    const before = store.getSnapshot();
    store.handleInput("j", NO_MODIFIERS);
    expect(store.getSnapshot()).toEqual(before);

    resolveDelete?.();
    await flush();
    expect(store.getSnapshot().busy).toBe(false);
  });

  it("mutation 失敗時は panel にエラーを表示し panelIndex を 0 にリセットする", async () => {
    const store = createPickerStore(
      [externalCandidate],
      noopCallbacks({
        switchRootHere: () => Promise.resolve({ ok: false, message: "dirty, use rm --force" }),
      }),
      () => {},
      () => {},
    );
    openPanel(store);
    store.handleInput("r", NO_MODIFIERS);
    // SwitchRoot on an external candidate requires confirmation; confirm it.
    expect(store.getSnapshot().mode.kind).toBe("confirm");
    store.handleInput("y", NO_MODIFIERS);
    await flush();
    const snapshot = store.getSnapshot();
    expect(snapshot.busy).toBe(false);
    expect(snapshot.mode).toEqual({
      kind: "panel",
      candidate: externalCandidate,
      error: "dirty, use rm --force",
    });
    expect(snapshot.panelIndex).toBe(0);
  });

  it("delete 成功後は一覧を再読込し list モードへ戻る", async () => {
    const reloaded: readonly PickCandidate[] = [managedCandidate];
    const store = createPickerStore(
      [managedCandidate],
      noopCallbacks({
        deleteWorktree: () => Promise.resolve({ ok: true }),
        reloadCandidates: () => Promise.resolve(reloaded),
      }),
      () => {},
      () => {},
    );
    openPanel(store);
    store.handleInput("d", NO_MODIFIERS);
    await flush();
    const snapshot = store.getSnapshot();
    expect(snapshot.mode).toEqual({ kind: "list" });
    expect(snapshot.filtered).toEqual(reloaded);
  });

  it("panel/confirm モード間の遷移: Esc で panel から list へ戻る", () => {
    const store = createPickerStore(
      [managedCandidate],
      noopCallbacks(),
      () => {},
      () => {},
    );
    openPanel(store);
    expect(store.getSnapshot().mode.kind).toBe("panel");
    store.handleInput("", { ...NO_MODIFIERS, escape: true });
    expect(store.getSnapshot().mode).toEqual({ kind: "list" });
  });

  it("subscribe したリスナーは非同期のミューテーション完了時にも通知される (キー入力なしで再描画できる)", async () => {
    const store = createPickerStore(
      [managedCandidate],
      noopCallbacks({ deleteWorktree: () => Promise.resolve({ ok: true }) }),
      () => {},
      () => {},
    );
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });
    openPanel(store);
    notifications = 0;
    store.handleInput("d", NO_MODIFIERS);
    expect(notifications).toBeGreaterThan(0); // Busy: true notified synchronously
    await flush();
    expect(store.getSnapshot().busy).toBe(false);
  });
});

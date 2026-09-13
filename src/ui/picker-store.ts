import type { PickerActionKind } from "../domain/actions.ts";
import { candidateBranchLabel, type PickCandidate } from "../domain/candidates.ts";
import { handleConfirmInput, handleListInput, handlePanelInput } from "./picker-input.ts";
import type { PickerCancelReason, PickerKeyModifiers } from "./picker-keys.ts";
import { sortCandidatesForDisplay } from "./picker-layout.ts";
import type { PickerCallbacks, PickerMode, PickerOutcome } from "./picker-types.ts";

const matchesQuery = (candidate: PickCandidate, query: string): boolean =>
  query.length === 0 || candidateBranchLabel(candidate).toLowerCase().includes(query.toLowerCase());

/**
 * The panel-with-error transition after a failed mutation (dirty rejection,
 * etc.). Always resets panelIndex to 0 — a previous version of this hook set
 * `mode` back to "panel" here without resetting panelIndex, so a stale
 * highlight from a larger action list (e.g. panelIndex 2 from a managed
 * worktree's panel) could survive onto a candidate with fewer actions (e.g.
 * external, cd + switchRoot only). The highlight then showed nothing
 * selected, but Enter still ran the index-clamped last action — a mismatch
 * between what's displayed and what runs. Exported (and pure) so this stays
 * covered without rendering the store — see picker-store.test.ts.
 */
export const panelErrorTransition = (
  candidate: PickCandidate,
  error: string,
): { readonly mode: PickerMode; readonly panelIndex: number } => ({
  mode: { kind: "panel", candidate, error },
  panelIndex: 0,
});

interface PickerState {
  readonly candidates: readonly PickCandidate[];
  readonly query: string;
  readonly index: number;
  readonly mode: PickerMode;
  readonly panelIndex: number;
  readonly busy: boolean;
}

/**
 * A memoizing filter+sort selector, factored out of createPickerStore to
 * keep that function under the lint line limit. Recomputes only when
 * candidates/query actually change, so repeated calls (e.g. from
 * useSyncExternalStore) return a stable array reference and don't cause
 * needless re-renders.
 */
const createFilteredSelector = () => {
  let cache: {
    readonly candidates: readonly PickCandidate[];
    readonly query: string;
    readonly result: readonly PickCandidate[];
  } | null = null;

  return (state: PickerState): readonly PickCandidate[] => {
    if (cache !== null && cache.candidates === state.candidates && cache.query === state.query) {
      return cache.result;
    }
    const result = sortCandidatesForDisplay(
      state.candidates.filter((candidate) => matchesQuery(candidate, state.query)),
    );
    cache = { candidates: state.candidates, query: state.query, result };
    return result;
  };
};

/**
 * Runs a delete/switchRoot mutation via `callbacks` and returns the state
 * patch to apply once it settles. Factored out of createPickerStore (kept
 * as a free function, not a closure) to keep that function under the lint
 * line limit — it only touches its arguments, no store-internal state.
 */
const runMutation = async (
  callbacks: PickerCallbacks,
  candidate: PickCandidate,
  action: Exclude<PickerActionKind, "cd">,
): Promise<
  | { readonly type: "exit"; readonly outcome: PickerOutcome }
  | { readonly type: "patch"; readonly patch: Partial<PickerState> }
> => {
  if (action === "switchRoot") {
    const result = await callbacks.switchRootHere(candidate);
    if (!result.ok || result.path === undefined) {
      const transition = panelErrorTransition(
        candidate,
        result.message ?? "Failed to switch root.",
      );
      return {
        type: "patch",
        patch: { mode: transition.mode, panelIndex: transition.panelIndex },
      };
    }
    return { type: "exit", outcome: { type: "path", path: result.path } };
  }
  const result = await callbacks.deleteWorktree(candidate);
  if (!result.ok) {
    const transition = panelErrorTransition(
      candidate,
      result.message ?? "Failed to delete worktree.",
    );
    return {
      type: "patch",
      patch: { mode: transition.mode, panelIndex: transition.panelIndex },
    };
  }
  const fresh = await callbacks.reloadCandidates();
  return {
    type: "patch",
    patch: { candidates: fresh, mode: { kind: "list" }, index: 0 },
  };
};

/** What the UI layer reads on every render — derived fields already computed. */
export interface PickerSnapshot {
  readonly query: string;
  readonly filtered: readonly PickCandidate[];
  readonly clampedIndex: number;
  readonly mode: PickerMode;
  readonly panelIndex: number;
  readonly busy: boolean;
}

export interface PickerStore {
  getSnapshot: () => PickerSnapshot;
  subscribe: (listener: () => void) => () => void;
  handleInput: (input: string, key: PickerKeyModifiers) => void;
}

/**
 * All picker state and transitions, framework-free (no React). A previous
 * version of this lived as a `useState`/`useMemo` React hook
 * (picker-controller.ts), which made the picker's rendering layer (ink)
 * mandatory just to exercise state transitions. Extracting it here lets
 * picker.tsx become a thin ink adapter (via useSyncExternalStore, see
 * picker-controller.ts) and lets a future non-ink renderer subscribe the
 * same way.
 *
 * Async mutations (delete / switchRoot) don't wait for a keypress to show
 * their result: `runAction` flips `busy` and notifies immediately, then
 * notifies again once the callback resolves (success or failure) so a
 * renderer subscribed via `subscribe` re-paints without needing more input.
 * `handleInput` ignores keys entirely while `busy` is true, so an in-flight
 * mutation can't be double-triggered by input that arrives before it
 * resolves.
 */
export const createPickerStore = (
  initialCandidates: readonly PickCandidate[],
  callbacks: PickerCallbacks,
  onExit: (outcome: PickerOutcome) => void,
  onCancel: (reason: PickerCancelReason) => void,
): PickerStore => {
  let state: PickerState = {
    candidates: initialCandidates,
    query: "",
    index: 0,
    mode: { kind: "list" },
    panelIndex: 0,
    busy: false,
  };
  const listeners = new Set<() => void>();
  const getFiltered = createFilteredSelector();

  let snapshotCache: PickerSnapshot | null = null;

  const notify = (): void => {
    snapshotCache = null;
    for (const listener of listeners) {
      listener();
    }
  };

  const setState = (patch: Partial<PickerState>): void => {
    state = { ...state, ...patch };
    notify();
  };

  const getSnapshot = (): PickerSnapshot => {
    if (snapshotCache !== null) {
      return snapshotCache;
    }
    const filtered = getFiltered(state);
    const clampedIndex = Math.min(state.index, Math.max(filtered.length - 1, 0));
    snapshotCache = {
      query: state.query,
      filtered,
      clampedIndex,
      mode: state.mode,
      panelIndex: state.panelIndex,
      busy: state.busy,
    };
    return snapshotCache;
  };

  const runAction = (candidate: PickCandidate, action: PickerActionKind): void => {
    if (action === "cd") {
      onExit({ type: "cd", candidate });
      return;
    }
    if (state.busy) {
      return;
    }
    setState({ busy: true });
    void (async () => {
      const outcome = await runMutation(callbacks, candidate, action);
      if (outcome.type === "exit") {
        onExit(outcome.outcome);
        return;
      }
      setState({ ...outcome.patch, busy: false });
    })();
  };

  const setIndex = (updater: (current: number) => number): void => {
    setState({ index: updater(state.index) });
  };
  const setQuery = (updater: (current: string) => string): void => {
    setState({ query: updater(state.query) });
  };
  const setPanelIndexByValue = (value: number): void => {
    setState({ panelIndex: value });
  };
  const setPanelIndexByUpdater = (updater: (current: number) => number): void => {
    setState({ panelIndex: updater(state.panelIndex) });
  };
  const setMode = (mode: PickerMode): void => {
    setState({ mode });
  };

  const handleInput = (input: string, key: PickerKeyModifiers): void => {
    if (state.busy) {
      return;
    }
    const { mode, panelIndex } = state;
    if (mode.kind === "confirm") {
      handleConfirmInput(input, key, mode, { runAction, setMode });
      return;
    }
    if (mode.kind === "panel") {
      handlePanelInput(input, key, mode, {
        panelIndex,
        runAction,
        setPanelIndex: setPanelIndexByUpdater,
        setMode,
      });
      return;
    }
    const filtered = getFiltered(state);
    const clampedIndex = Math.min(state.index, Math.max(filtered.length - 1, 0));
    handleListInput(input, key, {
      selectedCandidate: filtered[clampedIndex],
      filteredLength: filtered.length,
      runAction,
      onCancel,
      setIndex,
      setQuery,
      setPanelIndex: setPanelIndexByValue,
      setMode,
    });
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return { getSnapshot, subscribe, handleInput };
};

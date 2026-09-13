import { useState, useSyncExternalStore } from "react";
import type { PickCandidate } from "../domain/candidates.ts";
import { createPickerStore, type PickerSnapshot } from "./picker-store.ts";
import type { PickerCancelReason, PickerKeyModifiers } from "./picker-keys.ts";
import type { PickerCallbacks, PickerOutcome } from "./picker-types.ts";

export { panelErrorTransition } from "./picker-store.ts";

export interface PickerController extends PickerSnapshot {
  readonly handleInput: (input: string, key: PickerKeyModifiers) => void;
}

/**
 * Thin ink/React adapter over picker-store.ts's framework-free store. All
 * state and transitions live in the store; this hook only creates one store
 * per component instance (lazy useState initializer, so callbacks/onExit/
 * onCancel are captured once — picker.tsx never re-creates them across
 * re-renders, only the outer render() call constructs them) and subscribes
 * to it via useSyncExternalStore so async mutations (delete/switchRoot) can
 * trigger a re-render on completion without waiting for a keypress.
 */
export const usePickerController = (
  initialCandidates: readonly PickCandidate[],
  callbacks: PickerCallbacks,
  onExit: (outcome: PickerOutcome) => void,
  onCancel: (reason: PickerCancelReason) => void,
): PickerController => {
  const [store] = useState(() => createPickerStore(initialCandidates, callbacks, onExit, onCancel));
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);

  return { ...snapshot, handleInput: store.handleInput };
};

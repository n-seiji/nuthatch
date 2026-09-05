import { useMemo, useState } from "react";
import type { PickerActionKind } from "../domain/actions.ts";
import { candidateBranchLabel, type PickCandidate } from "../domain/candidates.ts";
import { handleConfirmDeleteInput, handleListInput, handlePanelInput } from "./picker-input.ts";
import type { PickerKeyModifiers } from "./picker-keys.ts";
import type { PickerCallbacks, PickerMode, PickerOutcome } from "./picker-types.ts";

const matchesQuery = (candidate: PickCandidate, query: string): boolean =>
  query.length === 0 || candidateBranchLabel(candidate).toLowerCase().includes(query.toLowerCase());

export interface PickerController {
  readonly query: string;
  readonly filtered: readonly PickCandidate[];
  readonly clampedIndex: number;
  readonly mode: PickerMode;
  readonly panelIndex: number;
  readonly busy: boolean;
  readonly handleInput: (input: string, key: PickerKeyModifiers) => void;
}

/**
 * All picker state, extracted from picker.tsx into a plain hook so the
 * component itself stays a thin render function. Per-mode key handling
 * (list / panel / confirmDelete) is further split into picker-input.ts's
 * pure-ish handlers, which this hook wires up to real setState calls.
 */
export const usePickerController = (
  initialCandidates: readonly PickCandidate[],
  callbacks: PickerCallbacks,
  onExit: (outcome: PickerOutcome) => void,
  onCancel: () => void,
): PickerController => {
  const [candidates, setCandidates] = useState(initialCandidates);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<PickerMode>({ kind: "list" });
  const [panelIndex, setPanelIndex] = useState(0);
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(
    () => candidates.filter((candidate) => matchesQuery(candidate, query)),
    [candidates, query],
  );
  const clampedIndex = Math.min(index, Math.max(filtered.length - 1, 0));
  const selectedCandidate = filtered[clampedIndex];

  const applyMutation = async (
    candidate: PickCandidate,
    action: Exclude<PickerActionKind, "cd">,
  ): Promise<void> => {
    if (action === "switchRoot") {
      const result = await callbacks.switchRootHere(candidate);
      if (!result.ok || result.path === undefined) {
        setMode({
          kind: "panel",
          candidate,
          error: result.message ?? "Failed to switch root.",
        });
        return;
      }
      onExit({ type: "path", path: result.path });
      return;
    }
    const result = await callbacks.deleteWorktree(candidate);
    if (!result.ok) {
      setMode({
        kind: "panel",
        candidate,
        error: result.message ?? "Failed to delete worktree.",
      });
      return;
    }
    const fresh = await callbacks.reloadCandidates();
    setCandidates(fresh);
    setMode({ kind: "list" });
    setIndex(0);
  };

  const runAction = (candidate: PickCandidate, action: PickerActionKind): void => {
    if (action === "cd") {
      onExit({ type: "cd", candidate });
      return;
    }
    if (busy) {
      return;
    }
    setBusy(true);
    void (async () => {
      await applyMutation(candidate, action);
      setBusy(false);
    })();
  };

  const handleInput = (input: string, key: PickerKeyModifiers): void => {
    if (busy) {
      return;
    }
    if (mode.kind === "confirmDelete") {
      handleConfirmDeleteInput(input, key, mode, { runAction, setMode });
      return;
    }
    if (mode.kind === "panel") {
      handlePanelInput(input, key, mode, {
        panelIndex,
        runAction,
        setPanelIndex,
        setMode,
      });
      return;
    }
    handleListInput(input, key, {
      selectedCandidate,
      filteredLength: filtered.length,
      runAction,
      onCancel,
      setIndex,
      setQuery,
      setPanelIndex: (value) => setPanelIndex(value),
      setMode,
    });
  };

  return { query, filtered, clampedIndex, mode, panelIndex, busy, handleInput };
};

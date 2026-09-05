import { Box, render, Text, useInput } from "ink";
import { useMemo, useState } from "react";
import { candidateBranchLabel, type PickCandidate } from "../domain/candidates.ts";
import { resolvePickerKeyAction } from "./picker-keys.ts";

const MAX_VISIBLE_ROWS = 15;

const kindTag = (candidate: PickCandidate): string =>
  candidate.kind === "worktree" ? candidate.worktree.kind : `new (${candidate.source})`;

const dirtyTag = (candidate: PickCandidate): string => {
  if (candidate.kind !== "worktree") {
    return "";
  }
  if (candidate.dirty === null) {
    return "";
  }
  return candidate.dirty ? " dirty" : "";
};

const pathTag = (candidate: PickCandidate): string =>
  candidate.kind === "worktree" ? candidate.worktree.path : "(not created yet)";

const matchesQuery = (candidate: PickCandidate, query: string): boolean =>
  query.length === 0 || candidateBranchLabel(candidate).toLowerCase().includes(query.toLowerCase());

export const candidateRowKey = (candidate: PickCandidate, index: number): string =>
  `${index}:${candidateBranchLabel(candidate)}`;

interface PickerProps {
  readonly candidates: readonly PickCandidate[];
  readonly onSelect: (candidate: PickCandidate) => void;
  readonly onCancel: () => void;
}

const Picker = ({ candidates, onSelect, onCancel }: PickerProps) => {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  const filtered = useMemo(
    () => candidates.filter((candidate) => matchesQuery(candidate, query)),
    [candidates, query],
  );
  const clampedIndex = Math.min(index, Math.max(filtered.length - 1, 0));

  useInput((input, key) => {
    const action = resolvePickerKeyAction(input, key);
    switch (action.type) {
      case "cancel": {
        onCancel();
        break;
      }
      case "select": {
        const selected = filtered[clampedIndex];
        if (selected !== undefined) {
          onSelect(selected);
        }
        break;
      }
      case "up": {
        setIndex((current) => Math.max(0, current - 1));
        break;
      }
      case "down": {
        setIndex((current) => Math.min(filtered.length - 1, current + 1));
        break;
      }
      case "clear": {
        setQuery("");
        setIndex(0);
        break;
      }
      case "backspace": {
        setQuery((current) => current.slice(0, -1));
        setIndex(0);
        break;
      }
      case "char": {
        setQuery((current) => current + action.char);
        setIndex(0);
        break;
      }
      case "ignore": {
        break;
      }
    }
  });

  const visible = filtered.slice(0, MAX_VISIBLE_ROWS);

  return (
    <Box flexDirection="column">
      <Text>
        hop: <Text color="cyan">{query}</Text>
        <Text dimColor>{query.length === 0 ? " (type to filter)" : ""}</Text>
      </Text>
      {visible.length === 0 && <Text dimColor>No matches.</Text>}
      {visible.map((candidate, rowIndex) => {
        const selected = rowIndex === clampedIndex;
        const label = candidateBranchLabel(candidate);
        return (
          <Text key={candidateRowKey(candidate, rowIndex)} inverse={selected}>
            {`${selected ? "> " : "  "}[${kindTag(candidate)}${dirtyTag(candidate)}] ${label} ${pathTag(candidate)}`}
          </Text>
        );
      })}
      {filtered.length > MAX_VISIBLE_ROWS && (
        <Text dimColor>
          ... and {filtered.length - MAX_VISIBLE_ROWS} more (keep typing to narrow down)
        </Text>
      )}
    </Box>
  );
};

/**
 * Renders the picker to stderr (never stdout — stdout is reserved for the
 * final selected path, per the CLI's cd contract) and resolves with the
 * chosen candidate, or null on ESC/Ctrl-C.
 */
export const runPicker = (candidates: readonly PickCandidate[]): Promise<PickCandidate | null> =>
  new Promise((resolve) => {
    const instance = render(
      <Picker
        candidates={candidates}
        onSelect={(candidate) => {
          instance.unmount();
          resolve(candidate);
        }}
        onCancel={() => {
          instance.unmount();
          resolve(null);
        }}
      />,
      { stdout: process.stderr },
    );
  });

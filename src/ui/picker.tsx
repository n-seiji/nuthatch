import { homedir } from "node:os";
import { Box, render, Text, useInput } from "ink";
import { candidateBranchName, type PickCandidate } from "../domain/candidates.ts";
import { EXIT_CANCELLED } from "../domain/result.ts";
import { type AltScreenTarget, enterAltScreen, leaveAltScreen } from "./alt-screen.ts";
import { ActionPanel } from "./action-panel.tsx";
import { usePickerController } from "./picker-controller.ts";
import { buildDisplayRows, displayRowKey, LEGEND_TEXT } from "./picker-layout.ts";
import type { PickerCallbacks, PickerOutcome } from "./picker-types.ts";

export type { ActionOutcome, PickerCallbacks, PickerOutcome } from "./picker-types.ts";

const MAX_VISIBLE_ROWS = 15;

interface PickerProps {
  readonly candidates: readonly PickCandidate[];
  readonly callbacks: PickerCallbacks;
  readonly onExit: (outcome: PickerOutcome) => void;
  readonly onCancel: () => void;
}

const Picker = ({ candidates, callbacks, onExit, onCancel }: PickerProps) => {
  const { query, filtered, clampedIndex, mode, panelIndex, busy, handleInput } =
    usePickerController(candidates, callbacks, onExit, onCancel);

  useInput(handleInput);

  const visible = filtered.slice(0, MAX_VISIBLE_ROWS);
  const hiddenCount = filtered.length - visible.length;
  const rows = buildDisplayRows(visible, homedir());

  return (
    <Box flexDirection="column">
      <Text>
        hop: <Text color="cyan">{query}</Text>
        <Text dimColor>{query.length === 0 ? " (type to filter)" : ""}</Text>
      </Text>
      {rows.length === 0 && <Text dimColor>No matches.</Text>}
      {rows.map((row) => {
        if (row.kind === "header") {
          return (
            <Text key={displayRowKey(row)} bold dimColor>
              {row.label}
            </Text>
          );
        }
        const selected = row.index === clampedIndex;
        return (
          <Text
            key={displayRowKey(row)}
            inverse={selected}
            dimColor={!selected && row.section === "branch"}
          >
            {`${selected ? "❯ " : "  "}${row.statusMarker} ${row.branchLabel}  ${row.kindLabel} ${row.pathLabel}`}
          </Text>
        );
      })}
      {hiddenCount > 0 && (
        <Text dimColor>... and {hiddenCount} more (keep typing to narrow down)</Text>
      )}
      <Text dimColor>({LEGEND_TEXT})</Text>
      <Text dimColor>
        Ctrl+K actions · Ctrl+X delete · Ctrl+R switch root · Enter cd · Esc cancel
      </Text>
      {mode.kind === "panel" && (
        <ActionPanel
          candidate={mode.candidate}
          panelIndex={panelIndex}
          error={mode.error}
          busy={busy}
        />
      )}
      {mode.kind === "confirmDelete" && (
        <Box flexDirection="column" borderStyle="round" paddingX={1}>
          <Text>
            Delete worktree for <Text color="cyan">{candidateBranchName(mode.candidate)}</Text>?
            (y/N)
          </Text>
        </Box>
      )}
    </Box>
  );
};

const createAltScreenTarget = (): AltScreenTarget => ({
  isTTY: process.stderr.isTTY === true,
  write: (data) => {
    process.stderr.write(data);
  },
});

/**
 * Renders the picker to stderr (never stdout — stdout is reserved for the
 * final selected path, per the CLI's cd contract) and resolves with the
 * chosen outcome, or null on ESC/Ctrl-C.
 *
 * Runs the picker inside the terminal's alternate screen buffer (fzf/vim
 * style) so it never gets pushed into scrollback history. `leaveOnce` is
 * idempotent and wired into every exit path — normal selection/cancel,
 * SIGINT, and a render()/unmount() throw — so the terminal is never left
 * stuck on the alt screen. It also runs on the process "exit" event as a
 * last-resort net for any path this function didn't anticipate. The
 * alt-screen leave always happens before `resolve`, so stdout's eventual
 * path/JSON output (written by the caller after this promise settles)
 * lands on the normal screen, not the one about to be torn down.
 */
export const runPicker = (
  candidates: readonly PickCandidate[],
  callbacks: PickerCallbacks,
): Promise<PickerOutcome | null> =>
  new Promise((resolve) => {
    const altScreen = createAltScreenTarget();
    let hasLeftAltScreen = false;
    const leaveOnce = (): void => {
      if (hasLeftAltScreen) {
        return;
      }
      hasLeftAltScreen = true;
      leaveAltScreen(altScreen);
    };
    process.once("exit", leaveOnce);

    const instanceRef: { current: ReturnType<typeof render> | null } = {
      current: null,
    };
    const handleSigint = (): void => {
      leaveOnce();
      instanceRef.current?.unmount();
      process.exitCode = EXIT_CANCELLED;
      process.exit(EXIT_CANCELLED);
    };
    process.once("SIGINT", handleSigint);

    const finish = (outcome: PickerOutcome | null): void => {
      leaveOnce();
      process.removeListener("SIGINT", handleSigint);
      instanceRef.current?.unmount();
      resolve(outcome);
    };

    enterAltScreen(altScreen);
    try {
      instanceRef.current = render(
        <Picker
          candidates={candidates}
          callbacks={callbacks}
          onExit={(outcome) => finish(outcome)}
          onCancel={() => finish(null)}
        />,
        { stdout: process.stderr },
      );
    } catch (error) {
      leaveOnce();
      process.removeListener("SIGINT", handleSigint);
      throw error;
    }
  });

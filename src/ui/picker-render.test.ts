import { describe, expect, it } from "bun:test";
import type { PickCandidate } from "../domain/candidates.ts";
import { displayWidth } from "../domain/display-width.ts";
import { renderPickerFrame } from "./picker.ts";
import type { PickerSnapshot } from "./picker-store.ts";

/**
 * Regression coverage for the astra/Fable-reported panel-overflow bug: at
 * 80-100 column terminals, the side-by-side panel used to get picked (the
 * old fixed 60-column isNarrowTerminal threshold) even though a candidate
 * row plus the gutter plus the panel didn't actually fit, so rows wrapped
 * in the real terminal. renderPickerFrame is exercised directly (no real
 * terminal needed) and every produced line is checked against the
 * terminal's own width.
 */

const ESC = "";
const CURSOR_HOME_AND_CLEAR = `${ESC}[H${ESC}[J`;

const worktreeCandidate = (branch: string, path: string): PickCandidate => ({
  kind: "worktree",
  worktree: {
    path,
    head: "abc123",
    branch,
    detached: false,
    bare: false,
    locked: false,
    lockReason: null,
    prunable: false,
    prunableReason: null,
    kind: "external",
  },
  dirty: false,
});

/** Splits a rendered frame into its individual display lines, stripping the leading cursor-home/clear-to-end sequence. */
const frameLines = (frame: string): string[] => {
  const withoutPrefix = frame.startsWith(CURSOR_HOME_AND_CLEAR)
    ? frame.slice(CURSOR_HOME_AND_CLEAR.length)
    : frame;
  return withoutPrefix.split("\r\n");
};

const buildSnapshotWithPanelOpen = (branch: string): PickerSnapshot => {
  const candidate = worktreeCandidate(branch, `/repo/${branch}`);
  return {
    query: "",
    filtered: [candidate],
    clampedIndex: 0,
    mode: { kind: "panel", candidate, error: null },
    panelIndex: 0,
    busy: false,
  };
};

describe("renderPickerFrame (side-by-side panel width)", () => {
  it.each([80, 100])("%i 桁端末で panel を開いても、どの行も端末幅を超えない", (width) => {
    const snapshot = buildSnapshotWithPanelOpen("feature/some-branch-name");
    const frame = renderPickerFrame({
      snapshot,
      width,
      height: 24,
      colorEnabled: false,
    });
    for (const line of frameLines(frame)) {
      expect(displayWidth(line)).toBeLessThanOrEqual(width);
    }
  });

  it("80 桁端末では panel が一覧の下に積まれる (横に並べると幅が足りないため)", () => {
    const snapshot = buildSnapshotWithPanelOpen("feature/some-branch-name");
    const frame = renderPickerFrame({
      snapshot,
      width: 80,
      height: 40,
      colorEnabled: false,
    });
    const lines = frameLines(frame);
    // Side-by-side would put "Actions for" on the same row as the query line; stacked puts it on its own row further down.
    const queryLineIndex = lines.findIndex((line) => line.startsWith("hop:"));
    const actionsLineIndex = lines.findIndex((line) => line.includes("Actions for"));
    expect(queryLineIndex).toBeGreaterThanOrEqual(0);
    expect(actionsLineIndex).toBeGreaterThan(queryLineIndex);
  });

  it("十分広い端末 (200 桁) では panel が一覧の隣に横並びになる", () => {
    const snapshot = buildSnapshotWithPanelOpen("feature/some-branch-name");
    const frame = renderPickerFrame({
      snapshot,
      width: 200,
      height: 24,
      colorEnabled: false,
    });
    const lines = frameLines(frame);
    const panelTopBorderIndex = lines.findIndex((line) => line.includes("╭"));
    // In the side-by-side layout, the box's top border shares a row with the list's first content row instead of appearing on its own line further down (as it does when stacked -- see the 80-column test above).
    expect(panelTopBorderIndex).toBe(0);
  });
});

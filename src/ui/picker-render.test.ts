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

const buildListSnapshot = (candidates: readonly PickCandidate[]): PickerSnapshot => ({
  query: "",
  filtered: candidates,
  clampedIndex: 0,
  mode: { kind: "list" },
  panelIndex: 0,
  busy: false,
});

/**
 * Regression coverage for the second astra/Fable-reported overflow: even
 * without a side panel, an unconstrained candidate row (long branch name +
 * long path) or the full-length footer hint routinely exceeded a narrow
 * terminal's actual width on their own, so the terminal itself wrapped
 * them -- inflating the real row count past what picker-viewport.ts's
 * rowBudget had estimated, which could scroll the screen.
 */
describe("renderPickerFrame (all rows fit the terminal width)", () => {
  const longBranchCandidate = worktreeCandidate(
    "feature/a-genuinely-very-long-branch-name-for-testing-overflow",
    "/Users/example/ghq/github.com/some-org/some-very-long-repository-name/subdir",
  );

  it.each([60, 80, 100, 140])("%i 桁端末では、描画される全行が端末幅に収まる", (width) => {
    const snapshot = buildListSnapshot([longBranchCandidate]);
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

  it.each([60, 80, 100, 140])(
    "%i 桁端末でも候補行から branch 名と状態マーカーが消えない",
    (width) => {
      const snapshot = buildListSnapshot([longBranchCandidate]);
      const frame = renderPickerFrame({
        snapshot,
        width,
        height: 24,
        colorEnabled: false,
      });
      const lines = frameLines(frame);
      const candidateLine = lines.find((line) => line.includes("❯"));
      expect(candidateLine).toBeDefined();
      // The status marker ("○" clean) and at least the start of the branch name must survive -- only the path column is allowed to shrink first.
      expect(candidateLine).toContain("○");
      expect(candidateLine).toContain("feature/a-genuinely");
    },
  );

  it.each([60, 80, 100, 140])("%i 桁端末でもフッターに終了方法 (Esc) が残る", (width) => {
    const snapshot = buildListSnapshot([longBranchCandidate]);
    const frame = renderPickerFrame({
      snapshot,
      width,
      height: 24,
      colorEnabled: false,
    });
    const lines = frameLines(frame);
    expect(lines.some((line) => line.includes("Esc"))).toBe(true);
  });

  it("全角文字・絵文字を含む branch 名でも、60 桁端末で行が端末幅を超えない", () => {
    const wideCandidate = worktreeCandidate(
      "フィーチャー/日本語-ブランチ-🎉-very-long-name",
      "/Users/example/ghq/github.com/some-org/repo",
    );
    const snapshot = buildListSnapshot([wideCandidate]);
    const frame = renderPickerFrame({
      snapshot,
      width: 60,
      height: 24,
      colorEnabled: false,
    });
    for (const line of frameLines(frame)) {
      expect(displayWidth(line)).toBeLessThanOrEqual(60);
    }
  });
});

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

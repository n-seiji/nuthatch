import { describe, expect, it } from "bun:test";
import {
  computeViewport,
  DEFAULT_TERMINAL_HEIGHT,
  MIN_VISIBLE_CANDIDATE_ROWS,
  rowBudget,
  STACKED_PANEL_ROW_BUDGET,
} from "./picker-viewport.ts";

describe("rowBudget", () => {
  it("端末の高さからチロム分を引いた行数を返す", () => {
    const budget = rowBudget({ terminalHeight: 30, panelStacked: false });
    expect(budget).toBeLessThan(30);
    expect(budget).toBeGreaterThan(0);
  });

  it("panel が縦積みのときは追加で STACKED_PANEL_ROW_BUDGET 分減る", () => {
    const withoutPanel = rowBudget({ terminalHeight: 30, panelStacked: false });
    const withPanel = rowBudget({ terminalHeight: 30, panelStacked: true });
    expect(withoutPanel - withPanel).toBe(STACKED_PANEL_ROW_BUDGET);
  });

  it("端末が極端に低くても MIN_VISIBLE_CANDIDATE_ROWS を下回らない", () => {
    expect(rowBudget({ terminalHeight: 1, panelStacked: true })).toBe(MIN_VISIBLE_CANDIDATE_ROWS);
    expect(rowBudget({ terminalHeight: 0, panelStacked: false })).toBe(MIN_VISIBLE_CANDIDATE_ROWS);
  });

  it("DEFAULT_TERMINAL_HEIGHT でも妥当な正の budget になる (高さが取れない場合の既定値)", () => {
    expect(
      rowBudget({
        terminalHeight: DEFAULT_TERMINAL_HEIGHT,
        panelStacked: false,
      }),
    ).toBeGreaterThan(MIN_VISIBLE_CANDIDATE_ROWS);
  });
});

describe("computeViewport", () => {
  it("候補数が budget 以下ならすべて表示し、隠れている件数は 0", () => {
    const viewport = computeViewport(5, 2, 10);
    expect(viewport).toEqual({
      start: 0,
      end: 5,
      hiddenAbove: 0,
      hiddenBelow: 0,
    });
  });

  it("選択が先頭付近なら window は先頭から始まる", () => {
    const viewport = computeViewport(100, 0, 10);
    expect(viewport.start).toBe(0);
    expect(viewport.end).toBe(10);
    expect(viewport.hiddenAbove).toBe(0);
    expect(viewport.start <= 0 && viewport.end > 0).toBe(true);
  });

  it("選択が末尾付近なら window は末尾で止まる (末尾を超えて伸びない)", () => {
    const viewport = computeViewport(100, 99, 10);
    expect(viewport.end).toBe(100);
    expect(viewport.start).toBe(90);
    expect(viewport.hiddenBelow).toBe(0);
    expect(viewport.start <= 99 && viewport.end > 99).toBe(true);
  });

  it("選択が中間ならその周辺を中心に window を作る", () => {
    const viewport = computeViewport(100, 50, 10);
    expect(viewport.start).toBeLessThanOrEqual(50);
    expect(viewport.end).toBeGreaterThan(50);
    expect(viewport.end - viewport.start).toBe(10);
  });

  it("選択が常に window 内に収まる (start <= selectedIndex < end)", () => {
    for (const selectedIndex of [0, 1, 10, 49, 50, 51, 89, 90, 98, 99]) {
      const viewport = computeViewport(100, selectedIndex, 10);
      expect(selectedIndex >= viewport.start).toBe(true);
      expect(selectedIndex < viewport.end).toBe(true);
    }
  });

  it("上下両方に隠れている件数を正しく報告する", () => {
    const viewport = computeViewport(100, 50, 10);
    expect(viewport.hiddenAbove).toBe(viewport.start);
    expect(viewport.hiddenBelow).toBe(100 - viewport.end);
    expect(viewport.hiddenAbove).toBeGreaterThan(0);
    expect(viewport.hiddenBelow).toBeGreaterThan(0);
  });

  it("budget が 0 や負でも壊れない (空 window を返す)", () => {
    const viewport = computeViewport(10, 0, 0);
    expect(viewport.end - viewport.start).toBe(0);
  });
});

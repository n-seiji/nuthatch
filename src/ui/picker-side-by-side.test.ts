import { describe, expect, it } from "bun:test";
import {
  isNarrowTerminal,
  MAX_CANDIDATE_ROW_WIDTH,
  MIN_SIDE_BY_SIDE_WIDTH,
} from "./picker-side-by-side.ts";

describe("isNarrowTerminal", () => {
  it("しきい値未満は狭いと判定する", () => {
    expect(isNarrowTerminal(MIN_SIDE_BY_SIDE_WIDTH - 1)).toBe(true);
    expect(isNarrowTerminal(1)).toBe(true);
  });

  it("しきい値以上は狭くないと判定する (side panel が一覧の隣に収まる)", () => {
    expect(isNarrowTerminal(MIN_SIDE_BY_SIDE_WIDTH)).toBe(false);
    expect(isNarrowTerminal(200)).toBe(false);
  });

  it("しきい値は候補行の最大幅を反映する (astra/Fable 指摘: 固定 60 は候補行/フッターの実幅より小さすぎた)", () => {
    // The threshold must be at least as wide as the widest candidate row can get -- otherwise side-by-side gets picked even though a full-width row would wrap.
    expect(MIN_SIDE_BY_SIDE_WIDTH).toBeGreaterThan(MAX_CANDIDATE_ROW_WIDTH);
  });

  it("しきい値は 100〜150 桁程度 (80/100 桁端末で panel を開くと従来の固定 60 では折り返していた)", () => {
    // Sanity-checks the computed threshold is in the ballpark astra/Fable arrived at by hand (widest footer hint ~104 cols + gutter 2 + panel 34 = ~140) -- both well above the old fixed 60, and above any 80/100-column terminal.
    expect(MIN_SIDE_BY_SIDE_WIDTH).toBeGreaterThanOrEqual(100);
    expect(MIN_SIDE_BY_SIDE_WIDTH).toBeLessThan(150);
  });
});

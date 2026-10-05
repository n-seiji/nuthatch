import { describe, expect, it } from "bun:test";
import { resolveTrackingRef } from "./tracking.ts";

describe("resolveTrackingRef", () => {
  it("remote のどれにも branch が無い場合、none を返す", () => {
    expect(resolveTrackingRef("feat/a", [])).toEqual({ kind: "none" });
  });

  it("origin だけに branch がある場合、origin/<branch> を track する", () => {
    expect(resolveTrackingRef("feat/a", ["origin"])).toEqual({
      kind: "track",
      ref: "origin/feat/a",
    });
  });

  it("origin と他の remote の両方に branch がある場合、並び順に関わらず origin を優先して track する", () => {
    expect(resolveTrackingRef("feat/a", ["fork", "origin", "upstream"])).toEqual({
      kind: "track",
      ref: "origin/feat/a",
    });
  });

  it("origin 以外の remote 1 つだけに branch がある場合、その remote の ref を track する", () => {
    expect(resolveTrackingRef("feat/a", ["upstream"])).toEqual({
      kind: "track",
      ref: "upstream/feat/a",
    });
  });

  it("origin 以外の複数の remote に branch がある場合、ambiguous を返す", () => {
    expect(resolveTrackingRef("feat/a", ["fork", "upstream"])).toEqual({
      kind: "ambiguous",
    });
  });
});

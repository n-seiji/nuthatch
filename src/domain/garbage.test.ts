import { describe, expect, it } from "bun:test";
import { type GarbageInput, classifyGarbage } from "./garbage.ts";

const base: GarbageInput = {
  prunable: false,
  clean: true,
  mergedIntoDefault: false,
  upstreamGone: false,
  allCommitsReachableFromDefault: false,
};

describe("classifyGarbage", () => {
  it("prunable な場合、dirty でも無条件で prunable を返す", () => {
    expect(classifyGarbage({ ...base, prunable: true, clean: false })).toBe("prunable");
  });

  it("merge 済みで clean な場合、merged を返す", () => {
    expect(classifyGarbage({ ...base, mergedIntoDefault: true })).toBe("merged");
  });

  it("merge 済みでも dirty な場合、null を返す (安全側で拒否)", () => {
    expect(classifyGarbage({ ...base, mergedIntoDefault: true, clean: false })).toBeNull();
  });

  it("upstream が gone かつ到達可能な commit がなく clean な場合、gone を返す", () => {
    expect(
      classifyGarbage({
        ...base,
        upstreamGone: true,
        allCommitsReachableFromDefault: true,
      }),
    ).toBe("gone");
  });

  it("到達可能性が unknown の場合、gone と判定せず null を返す", () => {
    expect(
      classifyGarbage({
        ...base,
        upstreamGone: true,
        allCommitsReachableFromDefault: "unknown",
      }),
    ).toBeNull();
  });

  it("merge 判定が unknown の場合、merged と判定しない", () => {
    expect(classifyGarbage({ ...base, mergedIntoDefault: "unknown" })).toBeNull();
  });

  it("何の条件も満たさない場合、null を返す", () => {
    expect(classifyGarbage(base)).toBeNull();
  });
});

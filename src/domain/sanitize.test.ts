import { describe, expect, it } from "bun:test";
import { sanitizeBranchName } from "./sanitize.ts";

const noneTaken = () => false;

describe("sanitizeBranchName", () => {
  it("衝突がない場合、スラッシュを二重アンダースコアに変換する", () => {
    expect(sanitizeBranchName("feat/foo", noneTaken)).toBe("feat__foo");
  });

  it("スラッシュを含まない branch はそのまま返す", () => {
    expect(sanitizeBranchName("main", noneTaken)).toBe("main");
  });

  it("feat/foo と feat-foo が衝突しないことを確認する", () => {
    expect(sanitizeBranchName("feat/foo", noneTaken)).not.toBe(
      sanitizeBranchName("feat-foo", noneTaken),
    );
  });

  it("候補が既に使われている場合、short hash を付与する", () => {
    const taken = new Set(["feat__foo"]);
    const result = sanitizeBranchName("feat/foo", (candidate) => taken.has(candidate));
    expect(result).not.toBe("feat__foo");
    expect(result.startsWith("feat__foo-")).toBe(true);
  });

  it("hash 付き候補まで衝突する場合、さらに別の候補を試す", () => {
    let calls = 0;
    const isTaken = (_candidate: string) => {
      calls++;
      return calls <= 2;
    };
    const result = sanitizeBranchName("feat/foo", isTaken);
    expect(typeof result).toBe("string");
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it("同じ branch 名は常に同じ hash 候補を生成する (決定的)", () => {
    const taken = new Set(["feat__foo"]);
    const a = sanitizeBranchName("feat/foo", (candidate) => taken.has(candidate));
    const b = sanitizeBranchName("feat/foo", (candidate) => taken.has(candidate));
    expect(a).toBe(b);
  });

  it("長大な branch 名を切り詰める", () => {
    const longBranch = `feat/${"a".repeat(300)}`;
    const result = sanitizeBranchName(longBranch, noneTaken);
    expect(result.length).toBeLessThanOrEqual(200);
  });
});

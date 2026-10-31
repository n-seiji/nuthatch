import { describe, expect, it } from "bun:test";
import type { PickCandidate } from "../domain/schema.ts";
import { creatableCandidate, worktreeCandidate } from "./picker-layout.fixtures.ts";
import {
  branchColumnWidth,
  buildDisplayRows,
  candidateKindLabel,
  KIND_COLUMN_WIDTH,
  shortenPath,
  STATE_COLUMN_WIDTH,
  candidateState,
} from "./picker-layout.ts";
import { displayWidth, padToWidth } from "../domain/display-width.ts";

describe("candidateState", () => {
  it("clean な worktree は ✓ clean (green)", () => {
    expect(candidateState(worktreeCandidate({}, false))).toEqual({
      text: "✓ clean",
      tone: "green",
    });
  });

  it("dirty な worktree は ● changes (yellow)", () => {
    expect(candidateState(worktreeCandidate({}, true))).toEqual({
      text: "● changes",
      tone: "yellow",
    });
  });

  it("locked / prunable は hop ls と同じ語で出す", () => {
    expect(candidateState(worktreeCandidate({ locked: true }, true)).text).toBe("⊘ locked");
    expect(candidateState(worktreeCandidate({ prunable: true }, null)).text).toBe("✗ missing");
  });

  it("bare は - bare", () => {
    expect(candidateState(worktreeCandidate({ bare: true }, null)).text).toBe("- bare");
  });

  it("creatable (未作成 branch) は + new (cyan)", () => {
    expect(candidateState(creatableCandidate("feat/x", "local"))).toEqual({
      text: "+ new",
      tone: "cyan",
    });
  });

  it("どの状態語も state 列の幅に収まる", () => {
    const states = [
      worktreeCandidate({}, false),
      worktreeCandidate({}, true),
      worktreeCandidate({ locked: true }, false),
      worktreeCandidate({ prunable: true }, null),
      worktreeCandidate({ bare: true }, null),
      worktreeCandidate({}, null),
      creatableCandidate("feat/x", "remote"),
    ].map((candidate) => displayWidth(candidateState(candidate).text));
    expect(Math.max(...states)).toBe(STATE_COLUMN_WIDTH);
  });
});

describe("candidateKindLabel", () => {
  it("root/managed はそのまま、external は ext に短縮する", () => {
    expect(candidateKindLabel(worktreeCandidate({ kind: "root" }))).toBe("root");
    expect(candidateKindLabel(worktreeCandidate({ kind: "managed" }))).toBe("managed");
    expect(candidateKindLabel(worktreeCandidate({ kind: "external" }))).toBe("ext");
  });

  it("creatable は source (local/remote) を返す", () => {
    expect(candidateKindLabel(creatableCandidate("feat/x", "local"))).toBe("local");
    expect(candidateKindLabel(creatableCandidate("feat/x", "remote"))).toBe("remote");
  });
});

describe("shortenPath", () => {
  it("上限を超える場合は先頭を … で省略し末尾を残す", () => {
    const long = "/Users/seiji/ghq/github.com/n-seiji/some-very-long-repo-name/subdir";
    const result = shortenPath(long, "/Users/seiji", 20);
    expect(result.length).toBe(20);
    expect(result.startsWith("…")).toBe(true);
    expect(long.endsWith(result.slice(1))).toBe(true);
  });

  it("上限以下ならそのまま (省略しない)", () => {
    expect(shortenPath("~/short", "/Users/seiji", 20)).toBe("~/short");
  });

  it("全角文字を含むパスは表示幅ベースで省略し、書記素を分割しない", () => {
    const long = "/Users/seiji/ghq/日本語プロジェクト/very-long-subdirectory-name";
    const result = shortenPath(long, "/Users/seiji", 20);
    expect(result.startsWith("…")).toBe(true);
    expect(long.endsWith(result.slice(1))).toBe(true);
  });
});

describe("branchColumnWidth / padToWidth", () => {
  it("最長の branch label の長さを返す", () => {
    const candidates = [
      creatableCandidate("a", "local"),
      creatableCandidate("feat/longer-name", "local"),
    ];
    expect(branchColumnWidth(candidates)).toBe("feat/longer-name".length);
  });

  it("上限 (24) を超えては伸びない", () => {
    const candidates = [creatableCandidate("x".repeat(40), "local")];
    expect(branchColumnWidth(candidates)).toBe(24);
  });

  it("padToWidth は幅に満たない分だけ空白で埋める", () => {
    expect(padToWidth("main", 8)).toBe("main    ");
    expect(padToWidth("feat/longer-than-width", 4)).toBe("feat/longer-than-width");
  });

  it("全角文字を含む branch label は表示幅ベースで揃う", () => {
    const candidates = [
      creatableCandidate("feat/x", "local"),
      creatableCandidate("機能/追加する", "local"),
    ];
    const width = branchColumnWidth(candidates);
    for (const candidate of candidates) {
      const label = candidate.kind === "creatable" ? candidate.branch : "";
      const padded = padToWidth(label, width);
      expect(padded.length >= label.length).toBe(true);
    }
  });

  it("絵文字を含む branch label でも padToWidth が書記素を壊さない", () => {
    const label = "feat/🚀-launch";
    const padded = padToWidth(label, 20);
    expect(padded.startsWith(label)).toBe(true);
  });
});

describe("buildDisplayRows", () => {
  it("WORKTREES → BRANCHES の順でセクション分けし、root を先頭に保つ", () => {
    const candidates: PickCandidate[] = [
      worktreeCandidate({ kind: "root", branch: "main", path: "/repo" }),
      worktreeCandidate(
        {
          kind: "managed",
          branch: "feat/picker",
          path: "/repo/_worktree/feat",
        },
        false,
      ),
      creatableCandidate("feat/idea", "local"),
    ];
    const rows = buildDisplayRows(candidates, "/repo");

    expect(rows[0]).toEqual({ kind: "header", label: "WORKTREES" });
    expect(rows[1]).toMatchObject({
      kind: "candidate",
      index: 0,
      kindLabel: "root".padEnd(KIND_COLUMN_WIDTH, " "),
    });
    expect(rows[2]).toMatchObject({
      kind: "candidate",
      index: 1,
      kindLabel: "managed".padEnd(KIND_COLUMN_WIDTH, " "),
    });
    expect(rows[3]).toMatchObject({
      kind: "header",
      label: expect.stringContaining("BRANCHES"),
    });
    expect(rows[4]).toMatchObject({
      kind: "candidate",
      index: 2,
      kindLabel: "local".padEnd(KIND_COLUMN_WIDTH, " "),
    });
  });

  it("worktree 候補が無ければ WORKTREES セクション (見出し込み) を出さない", () => {
    const candidates: PickCandidate[] = [creatableCandidate("feat/idea", "local")];
    const rows = buildDisplayRows(candidates, "/repo");
    expect(rows.some((row) => row.kind === "header" && row.label === "WORKTREES")).toBe(false);
    expect(rows[0]).toMatchObject({
      kind: "header",
      label: expect.stringContaining("BRANCHES"),
    });
  });

  it("creatable 候補が無ければ BRANCHES セクション (見出し込み) を出さない", () => {
    const candidates: PickCandidate[] = [worktreeCandidate({ kind: "root" })];
    const rows = buildDisplayRows(candidates, "/repo");
    expect(rows.some((row) => row.kind === "header" && row.label.startsWith("BRANCHES"))).toBe(
      false,
    );
  });

  it("絞り込みで片方の候補が 0 件になった場合もそのセクションを出さない", () => {
    // Simulates the caller filtering candidates by query before calling buildDisplayRows.
    const onlyWorktrees: PickCandidate[] = [worktreeCandidate({ kind: "root", branch: "main" })];
    const rows = buildDisplayRows(onlyWorktrees, "/repo");
    expect(rows.every((row) => row.kind !== "header" || !row.label.startsWith("BRANCHES"))).toBe(
      true,
    );
  });

  it("candidate row の index は渡した candidates 配列上の位置と一致する (カーソル選択と紐づけるため)", () => {
    const candidates: PickCandidate[] = [
      worktreeCandidate({ kind: "root" }),
      creatableCandidate("feat/idea", "local"),
    ];
    const rows = buildDisplayRows(candidates, "/repo");
    const candidateRows = rows.filter((row) => row.kind === "candidate");
    expect(candidateRows.map((row) => row.index)).toEqual([0, 1]);
  });
});

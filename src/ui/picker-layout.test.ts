import { describe, expect, it } from "bun:test";
import type { PickCandidate } from "../domain/candidates.ts";
import type { Worktree } from "../domain/model.ts";
import {
  branchColumnWidth,
  buildDisplayRows,
  candidateKindLabel,
  KIND_COLUMN_WIDTH,
  padBranchLabel,
  shortenPath,
  statusMarker,
} from "./picker-layout.ts";

const worktree = (overrides: Partial<Worktree> = {}): Worktree => ({
  path: "/repo",
  head: "abc",
  branch: "main",
  detached: false,
  bare: false,
  locked: false,
  lockReason: null,
  prunable: false,
  prunableReason: null,
  kind: "root",
  ...overrides,
});

const worktreeCandidate = (
  overrides: Partial<Worktree> = {},
  dirty: boolean | null = null,
): PickCandidate => ({
  kind: "worktree",
  worktree: worktree(overrides),
  dirty,
});

const creatableCandidate = (branch: string, source: "local" | "remote"): PickCandidate => ({
  kind: "creatable",
  branch,
  source,
});

describe("statusMarker", () => {
  it("dirty な worktree は ●", () => {
    expect(statusMarker(worktreeCandidate({}, true))).toBe("●");
  });

  it("clean な worktree は ○", () => {
    expect(statusMarker(worktreeCandidate({}, false))).toBe("○");
  });

  it("dirty 不明 (null) な worktree は空白", () => {
    expect(statusMarker(worktreeCandidate({}, null))).toBe(" ");
  });

  it("creatable (未作成 branch) は +", () => {
    expect(statusMarker(creatableCandidate("feat/x", "local"))).toBe("+");
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
  it("$HOME 配下のパスは ~ に置換する", () => {
    expect(shortenPath("/Users/seiji/ghq/repo", "/Users/seiji")).toBe("~/ghq/repo");
  });

  it("$HOME と完全一致する場合は ~ そのもの", () => {
    expect(shortenPath("/Users/seiji", "/Users/seiji")).toBe("~");
  });

  it("$HOME 配下でないパスはそのまま", () => {
    expect(shortenPath("/tmp/repo", "/Users/seiji")).toBe("/tmp/repo");
  });

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
});

describe("branchColumnWidth / padBranchLabel", () => {
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

  it("padBranchLabel は幅に満たない分だけ空白で埋める", () => {
    expect(padBranchLabel("main", 8)).toBe("main    ");
    expect(padBranchLabel("feat/longer-than-width", 4)).toBe("feat/longer-than-width");
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

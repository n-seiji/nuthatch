import { describe, expect, it } from "bun:test";
import type { PickCandidate } from "../domain/candidates.ts";
import { creatableCandidate, worktreeCandidate } from "./picker-layout.fixtures.ts";
import { buildDisplayRows, sortCandidatesForDisplay } from "./picker-layout.ts";

const branchLabelsOf = (candidates: readonly PickCandidate[]): readonly string[] =>
  candidates.map((candidate) =>
    candidate.kind === "worktree" ? (candidate.worktree.branch ?? "(detached)") : candidate.branch,
  );

describe("sortCandidatesForDisplay", () => {
  it("WORKTREES: root が先頭、続いて managed → ext の順、各グループ内は branch 名昇順", () => {
    const candidates: PickCandidate[] = [
      worktreeCandidate({ kind: "external", branch: "codex/fix-b" }),
      worktreeCandidate({ kind: "managed", branch: "feat/z" }),
      worktreeCandidate({ kind: "external", branch: "codex/fix-a" }),
      worktreeCandidate({ kind: "root", branch: "main" }),
      worktreeCandidate({ kind: "managed", branch: "feat/a" }),
    ];
    const sorted = sortCandidatesForDisplay(candidates);
    expect(branchLabelsOf(sorted)).toEqual([
      "main",
      "feat/a",
      "feat/z",
      "codex/fix-a",
      "codex/fix-b",
    ]);
  });

  it("BRANCHES: worktree の無い local branch → remote branch の順、それぞれ名前昇順", () => {
    const candidates: PickCandidate[] = [
      creatableCandidate("origin/hotfix", "remote"),
      creatableCandidate("feat/idea", "local"),
      creatableCandidate("origin/alpha", "remote"),
      creatableCandidate("feat/aaa", "local"),
    ];
    const sorted = sortCandidatesForDisplay(candidates);
    expect(branchLabelsOf(sorted)).toEqual([
      "feat/aaa",
      "feat/idea",
      "origin/alpha",
      "origin/hotfix",
    ]);
  });

  it("detached HEAD の worktree は branch 名で並べられないので、各 kind グループの末尾に置く", () => {
    const candidates: PickCandidate[] = [
      worktreeCandidate({
        kind: "managed",
        branch: null,
        detached: true,
        path: "/repo/detached-1",
      }),
      worktreeCandidate({ kind: "managed", branch: "feat/z" }),
      worktreeCandidate({ kind: "managed", branch: "feat/a" }),
      worktreeCandidate({ kind: "root", branch: "main" }),
      worktreeCandidate({
        kind: "external",
        branch: null,
        detached: true,
        path: "/repo/detached-2",
      }),
      worktreeCandidate({ kind: "external", branch: "codex/fix" }),
    ];
    const sorted = sortCandidatesForDisplay(candidates);
    expect(branchLabelsOf(sorted)).toEqual([
      "main",
      "feat/a",
      "feat/z",
      "(detached)",
      "codex/fix",
      "(detached)",
    ]);
  });

  it("WORKTREES セクション全体が BRANCHES セクションより前に来る (グループ順は kind で固定)", () => {
    const candidates: PickCandidate[] = [
      creatableCandidate("feat/idea", "local"),
      worktreeCandidate({ kind: "managed", branch: "feat/z" }),
      worktreeCandidate({ kind: "root", branch: "main" }),
    ];
    const sorted = sortCandidatesForDisplay(candidates);
    expect(sorted.map((candidate) => candidate.kind)).toEqual([
      "worktree",
      "worktree",
      "creatable",
    ]);
  });

  it("絞り込み (フィルタ) 後に適用しても順序が維持される", () => {
    const candidates: PickCandidate[] = [
      worktreeCandidate({ kind: "external", branch: "feat/ext-b" }),
      worktreeCandidate({ kind: "managed", branch: "feat/managed-a" }),
      worktreeCandidate({ kind: "root", branch: "main" }),
      worktreeCandidate({ kind: "external", branch: "feat/ext-a" }),
      creatableCandidate("feat/local-only", "local"),
    ];
    // Simulates the picker's own flow: filter by query ("feat") first, then sort for display.
    const filtered = candidates.filter((candidate) =>
      branchLabelsOf([candidate])[0]?.includes("feat"),
    );
    const sorted = sortCandidatesForDisplay(filtered);
    expect(branchLabelsOf(sorted)).toEqual([
      "feat/managed-a",
      "feat/ext-a",
      "feat/ext-b",
      "feat/local-only",
    ]);
  });

  it("buildDisplayRows と組み合わせても表示順が仕様どおりになる (統合確認)", () => {
    const candidates: PickCandidate[] = [
      worktreeCandidate({ kind: "external", branch: "codex/fix-x" }),
      worktreeCandidate({ kind: "root", branch: "main" }),
      worktreeCandidate({ kind: "managed", branch: "feat/picker" }),
      creatableCandidate("origin/hotfix", "remote"),
      creatableCandidate("feat/idea", "local"),
    ];
    const sorted = sortCandidatesForDisplay(candidates);
    const rows = buildDisplayRows(sorted, "/repo");
    const candidateBranchLabels = rows
      .filter((row) => row.kind === "candidate")
      .map((row) => row.branchLabel.trim());
    expect(candidateBranchLabels).toEqual([
      "main",
      "feat/picker",
      "codex/fix-x",
      "feat/idea",
      "origin/hotfix",
    ]);
  });

  it("row.index はソート後の配列上の位置を指す (カーソルとズレないよう、表示だけでなく候補配列自体をソート済みで使う前提)", () => {
    // Deliberately unsorted input (external before managed, remote before local): if a caller only reordered the *display* (e.g. sorted a copy just for rendering) while the picker's actual candidate/cursor array stayed in this original order, row.index values here would point at the wrong entries — e.g. index 0 would still be the external worktree, not root.
    const candidates: PickCandidate[] = [
      worktreeCandidate({ kind: "external", branch: "codex/fix-x" }),
      worktreeCandidate({ kind: "root", branch: "main" }),
      creatableCandidate("origin/hotfix", "remote"),
      creatableCandidate("feat/idea", "local"),
    ];
    const sorted = sortCandidatesForDisplay(candidates);
    // Expected display order: main (root), codex/fix-x (external), feat/idea (local), origin/hotfix (remote).
    const rows = buildDisplayRows(sorted, "/repo");
    const candidateRows = rows.filter((row) => row.kind === "candidate");

    // Each row's index must resolve back to the matching candidate in `sorted` — the same array the picker uses for its cursor — not the pre-sort `candidates`.
    candidateRows.forEach((row, position) => {
      expect(sorted[row.index]).toBe(sorted[position]);
    });
    expect(candidateRows.map((row) => row.index)).toEqual([0, 1, 2, 3]);
  });
});

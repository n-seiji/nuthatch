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
});

import { describe, expect, it } from "bun:test";
import type { LsEntry } from "./domain/schema.ts";
import { formatLsTable } from "./render-ls.ts";

const HOME = "/home/me";

const entry = (overrides: Partial<LsEntry>): LsEntry => ({
  path: `${HOME}/ghq/github.com/me/app`,
  head: "9e4ca907f315af4013950f48afffceebea310579",
  branch: "main",
  detached: false,
  bare: false,
  locked: false,
  lockReason: null,
  prunable: false,
  prunableReason: null,
  kind: "root",
  dirty: false,
  ahead: null,
  behind: null,
  ...overrides,
});

const WT = `${HOME}/ghq/github.com/me/_worktree/app`;

const entries: LsEntry[] = [
  entry({ path: `${HOME}/.claude-wt/agent-x`, branch: "claude/agent-x", kind: "external" }),
  entry({
    path: `${WT}/feat__login`,
    branch: "feat/login",
    kind: "managed",
    dirty: true,
    ahead: 2,
    behind: 1,
  }),
  entry({}),
  entry({ path: `${WT}/chore__deps`, branch: "chore/deps", kind: "managed", ahead: 0, behind: 0 }),
];

const plain = (cwd = "/elsewhere", width: number | null = null): string =>
  formatLsTable(entries, { color: false, width, home: HOME, cwd });

describe("formatLsTable", () => {
  it("renders a header, one row per worktree (root → managed → external) and a summary", () => {
    expect(plain()).toBe(
      [
        "  BRANCH          STATE      REMOTE  KIND      PATH",
        "  main            ✓ clean    -       root      ~/ghq/github.com/me/app",
        "  chore/deps      ✓ clean    =       managed   ~/ghq/github.com/me/_worktree/app/chore__deps",
        "  feat/login      ● changes  ↑2 ↓1   managed   ~/ghq/github.com/me/_worktree/app/feat__login",
        "  claude/agent-x  ✓ clean    -       external  ~/.claude-wt/agent-x",
        "",
        "4 worktrees · 1 with changes · 1 ahead · 1 external",
        "",
      ].join("\n"),
    );
  });

  it("marks the worktree the cwd is in with @ (the deepest match wins)", () => {
    const lines = plain(`${WT}/feat__login/src`).split("\n");
    expect(lines.find((line) => line.includes("feat/login"))?.startsWith("@ ")).toBe(true);
    expect(lines.filter((line) => line.startsWith("@ "))).toHaveLength(1);
  });

  it("does not treat a sibling path sharing a prefix as inside", () => {
    expect(plain(`${HOME}/ghq/github.com/me/app-other`)).not.toContain("@ ");
  });

  it("explains rows that cannot be acted on before dirtiness", () => {
    const table = formatLsTable(
      [
        entry({ branch: "gone", kind: "managed", prunable: true, dirty: true }),
        entry({ branch: "held", kind: "managed", locked: true }),
        entry({ branch: null, detached: true, kind: "external", path: "/x" }),
      ],
      { color: false, width: null, home: HOME, cwd: "/" },
    );
    expect(table).toMatch(/gone +✗ missing/u);
    expect(table).toMatch(/held +⊘ locked/u);
    expect(table).toContain("(detached 9e4ca90)");
    expect(table).toContain("2 locked or missing");
  });

  it("shrinks only the path, keeping its tail, to fit the terminal width", () => {
    const lines = plain("/", 60).split("\n");
    const row = lines.find((line) => line.includes("feat/login")) ?? "";
    expect(row.length).toBeLessThanOrEqual(60);
    expect(row.endsWith("feat__login")).toBe(true);
    expect(row).toContain("…");
  });

  it("colors only when asked, and plain output has no escape codes", () => {
    expect(plain()).not.toContain("\u001B[");
    const colored = formatLsTable(entries, { color: true, width: null, home: HOME, cwd: "/" });
    expect(colored).toContain("\u001B[33m● changes\u001B[0m");
    expect(colored).toContain("\u001B[32m↑2\u001B[0m");
  });
});

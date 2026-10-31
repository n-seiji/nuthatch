import { homedir } from "node:os";
import { describe, expect, it } from "bun:test";
import { displayWidth } from "../domain/display-width.ts";
import type { PickCandidate } from "../domain/schema.ts";
import { ESC, SGR, SGR_RESET } from "../domain/ansi.ts";
import { creatableCandidate, worktreeCandidate } from "./picker-layout.fixtures.ts";
import { renderPickerFrame } from "./picker-render.ts";
import { sortCandidatesForDisplay } from "./picker-layout.ts";
import type { PickerSnapshot } from "./picker-store.ts";

/**
 * The picker's chrome as the user sees it: header, state words, section
 * rules and the key-hint footer, rendered through renderPickerFrame.
 */

const HOME = homedir();
const WT = `${HOME}/ghq/github.com/me/_worktree/app`;
const CLEAR = `${ESC}[H${ESC}[J`;

const candidates: readonly PickCandidate[] = [
  worktreeCandidate({ kind: "root", path: `${HOME}/ghq/github.com/me/app` }, false),
  worktreeCandidate({ kind: "managed", branch: "chore/deps", path: `${WT}/chore__deps` }, false),
  worktreeCandidate({ kind: "managed", branch: "feat/login", path: `${WT}/feat__login` }, true),
  worktreeCandidate(
    {
      kind: "external",
      branch: "claude/agent-x",
      path: `${HOME}/.claude-wt/agent-x`,
    },
    false,
  ),
  creatableCandidate("feat/idea", "local"),
];

const snapshot = (overrides: Partial<PickerSnapshot> = {}): PickerSnapshot => {
  const filtered = overrides.filtered ?? sortCandidatesForDisplay(candidates);
  return {
    candidates: overrides.candidates ?? candidates,
    query: "",
    filtered,
    clampedIndex: 0,
    mode: { kind: "list" },
    panelIndex: 0,
    busy: false,
    ...overrides,
  };
};

const frameLines = (
  width: number,
  options: { color?: boolean; height?: number; snap?: PickerSnapshot } = {},
): string[] => {
  const frame = renderPickerFrame({
    snapshot: options.snap ?? snapshot(),
    width,
    height: options.height ?? 24,
    colorEnabled: options.color ?? false,
  });
  return frame.slice(CLEAR.length).split("\r\n");
};

describe("renderPickerFrame (chrome)", () => {
  it("ヘッダ・クエリ・section 罫線・状態語・フッターを並べる (凡例は無い)", () => {
    const lines = frameLines(100);
    expect(lines[0]).toBe("◆ app  4 worktrees · 1 with changes · 1 branch");
    expect(lines[1]).toBe("hop:  (type to filter)");
    expect(lines[2]?.startsWith("WORKTREES ─")).toBe(true);
    expect(lines[3]?.startsWith("❯ ✓ clean   main ")).toBe(true);
    expect(lines[4]?.startsWith("  ✓ clean   chore/deps ")).toBe(true);
    expect(lines[5]?.startsWith("  ● changes feat/login ")).toBe(true);
    expect(lines[6]?.startsWith("  ✓ clean   claude/agent-x ")).toBe(true);
    expect(lines[7]?.startsWith("BRANCHES — Enter creates a worktree ─")).toBe(true);
    expect(lines[8]?.startsWith("  + new     feat/idea ")).toBe(true);
    expect(lines.join("\n")).not.toContain("=dirty");
  });

  it("section 罫線は最も幅の広い行の幅で止まる", () => {
    const lines = frameLines(100);
    const rowWidths = [3, 4, 5, 6, 8].map((index) => displayWidth(lines[index] ?? ""));
    const widest = Math.max(...rowWidths);
    expect(displayWidth(lines[2] ?? "")).toBe(widest);
    expect(displayWidth(lines[7] ?? "")).toBe(widest);
  });

  it("絞り込み中は N matches を足し、件数は絞り込み前の候補から数える", () => {
    const filtered = sortCandidatesForDisplay(candidates).filter(
      (candidate) => candidate.kind === "worktree" && candidate.worktree.branch === "feat/login",
    );
    const lines = frameLines(100, {
      snap: snapshot({ query: "login", filtered }),
    });
    expect(lines[0]).toBe("◆ app  4 worktrees · 1 with changes · 1 branch · 1 match");
    expect(lines[1]).toBe("hop: login");
  });

  it("locked / missing の worktree は hop ls と同じ状態語で出る", () => {
    const states: readonly PickCandidate[] = [
      worktreeCandidate({ kind: "root", path: "/r/app" }, false),
      worktreeCandidate({ kind: "managed", branch: "a", path: "/r/a", locked: true }, false),
      worktreeCandidate({ kind: "managed", branch: "b", path: "/r/b", prunable: true }, null),
    ];
    const text = frameLines(100, {
      snap: snapshot({
        candidates: states,
        filtered: sortCandidatesForDisplay(states),
      }),
    }).join("\n");
    expect(text).toContain("⊘ locked");
    expect(text).toContain("✗ missing");
  });

  it("フッターは実際に効くキーだけを出す (Ctrl+J は動かない)", () => {
    const footer = frameLines(140).at(-1) ?? "";
    expect(footer).toBe(
      "Tab/→/Ctrl+L actions · Ctrl+X delete · Ctrl+R switch root · ↑↓/Ctrl+P,N,K move · Enter cd · Esc cancel",
    );
    expect(footer).not.toContain("Ctrl+J");
  });

  it.each([40, 60, 80, 100, 110, 130])("%i 桁でも全行が端末幅に収まる", (width) => {
    for (const line of frameLines(width)) {
      expect(displayWidth(line)).toBeLessThanOrEqual(width);
    }
  });

  it("行数 (ヘッダ込み) が端末の高さを超えない", () => {
    const many = [
      candidates[0] as PickCandidate,
      ...Array.from({ length: 30 }, (_unused, index) =>
        worktreeCandidate({ kind: "managed", branch: `b${index}`, path: `/r/b${index}` }, false),
      ),
    ];
    for (const height of [10, 16, 24]) {
      const lines = frameLines(100, {
        height,
        snap: snapshot({
          candidates: many,
          filtered: sortCandidatesForDisplay(many),
        }),
      });
      expect(lines.length).toBeLessThanOrEqual(height);
    }
  });
});

describe("renderPickerFrame (chrome, color)", () => {
  const lines = frameLines(100, { color: true });

  it("選択行は state の色を保ち、cyan の ❯ と inverse の branch 名で示す", () => {
    expect(lines[3]).toContain(`${SGR.cyan}❯${SGR_RESET}`);
    expect(lines[3]).toContain(`${SGR.green}✓ clean  ${SGR_RESET}`);
    expect(lines[3]).toContain(`${SGR.inverse}main${SGR_RESET}`);
    expect(lines[4]).not.toContain(SGR.inverse);
  });

  it("changes は黄色、新規 branch は cyan の状態語", () => {
    expect(lines[5]).toContain(`${SGR.yellow}● changes${SGR_RESET}`);
    expect(lines[8]).toContain(`${SGR.cyan}+ new    ${SGR_RESET}`);
  });

  it("ヘッダの変更あり件数は黄色、フッターのキーは太字で説明は薄い", () => {
    expect(lines[0]).toContain(`${SGR.yellow}1 with changes${SGR_RESET}`);
    expect(lines.at(-1)).toContain(`${SGR.bold}Enter${SGR_RESET}${SGR.dim} cd${SGR_RESET}`);
  });
});

import { describe, expect, it } from "bun:test";
import { type ArgsSpec, parseCliArgs } from "./cli-args.ts";

const JUMP: ArgsSpec = {
  positionals: [{ name: "target", required: false }],
  booleans: ["create", "json"],
  strings: ["track"],
};

describe("parseCliArgs", () => {
  it("位置引数とフラグを順不同で分ける", () => {
    const args = parseCliArgs(["--json", "feat/x", "--create"], JUMP);

    expect(args.positionals).toEqual({ target: "feat/x" });
    expect(args.booleans).toEqual({ create: true, json: true });
    expect(args.strings).toEqual({});
  });

  it("宣言済みの boolean が無い場合は false になる", () => {
    expect(parseCliArgs([], JUMP).booleans).toEqual({ create: false, json: false });
  });

  it("boolean フラグは次のトークンを値として飲み込まない", () => {
    expect(parseCliArgs(["--json", "feat"], JUMP).positionals).toEqual({ target: "feat" });
  });

  it("--name=false / --no-name で boolean を false にする", () => {
    expect(parseCliArgs(["--json=false"], JUMP).booleans.json).toBe(false);
    expect(parseCliArgs(["--json=true"], JUMP).booleans.json).toBe(true);
    expect(parseCliArgs(["--json", "--no-json"], JUMP).booleans.json).toBe(false);
  });

  it("string フラグは --name value / --name=value のどちらでも値を取る", () => {
    expect(parseCliArgs(["--track", "origin/x", "x"], JUMP)).toMatchObject({
      positionals: { target: "x" },
      strings: { track: "origin/x" },
    });
    expect(parseCliArgs(["x", "--track=origin/x"], JUMP).strings).toEqual({ track: "origin/x" });
  });

  it("string フラグの次が - で始まる場合は値を取らず空文字にする", () => {
    expect(parseCliArgs(["--track", "--json"], JUMP)).toMatchObject({
      booleans: { json: true },
      strings: { track: "" },
    });
  });

  it("kebab-case と camelCase のフラグを同じものとして扱う", () => {
    const spec: ArgsSpec = { booleans: ["dryRun", "withBranch"] };

    expect(parseCliArgs(["--dry-run", "--with-branch"], spec).booleans).toEqual({
      dryRun: true,
      withBranch: true,
    });
    expect(parseCliArgs(["--dryRun"], spec).booleans.dryRun).toBe(true);
  });

  it("-- 以降はすべて位置引数として扱う", () => {
    expect(parseCliArgs(["--", "--json"], JUMP)).toMatchObject({
      positionals: { target: "--json" },
      booleans: { json: false },
    });
  });

  it("単独の - は位置引数として残す (hop root - / hop -)", () => {
    const spec: ArgsSpec = {
      positionals: [{ name: "branch", required: false }],
      booleans: ["json"],
      strings: ["track"],
    };

    expect(parseCliArgs(["-"], spec).positionals).toEqual({ branch: "-" });
    expect(parseCliArgs(["--json", "-"], spec).positionals).toEqual({ branch: "-" });
    expect(parseCliArgs(["-", "--json"], spec)).toMatchObject({
      positionals: { branch: "-" },
      booleans: { json: true },
    });
    expect(parseCliArgs(["--track", "origin/x", "-"], spec)).toMatchObject({
      positionals: { branch: "-" },
      strings: { track: "origin/x" },
    });
  });

  it("未知のフラグは無視するが、citty と同じく次の非フラグトークンを値として飲み込む", () => {
    expect(parseCliArgs(["--bogus", "feat"], JUMP).positionals).toEqual({ target: undefined });
    expect(parseCliArgs(["--bogus=1", "feat"], JUMP).positionals).toEqual({ target: "feat" });
    expect(parseCliArgs(["-x", "feat"], JUMP).positionals).toEqual({ target: undefined });
    expect(parseCliArgs(["--bogus", "--json", "feat"], JUMP)).toMatchObject({
      positionals: { target: "feat" },
      booleans: { json: true },
    });
  });

  it("必須の位置引数が無い場合は citty と同じメッセージで throw する", () => {
    const spec: ArgsSpec = { positionals: [{ name: "branch", required: true }] };

    expect(() => parseCliArgs(["--json"], spec)).toThrow(
      "Missing required positional argument: BRANCH",
    );
  });
});

import { describe, expect, it } from "bun:test";
import { dispatchCliArgs, isHelpRequest, normalizeCliArgs } from "./cli-dispatch.ts";

const reservedNames = ["ls", "rm", "clean", "root", "init"];

describe("cli dispatch", () => {
  it("argv0 と同じ引数はコンパイル済みバイナリのときだけ除去する (stdout の TTY 判定には依存しない)", () => {
    const argv0 = "/usr/local/bin/hop";

    // Stdout がパイプ (shell wrapper が `$(command hop "$@")` で捕まえるケース)
    // でも、コンパイル済みバイナリなら除去する — ここが今回の不具合そのもの。
    expect(normalizeCliArgs([argv0], argv0, true)).toEqual([]);
  });

  it("コンパイル済みバイナリでなければ、argv0 と同じ引数でも素通りする", () => {
    const argv0 = "/usr/local/bin/hop";

    expect(normalizeCliArgs([argv0], argv0, false)).toEqual([argv0]);
  });

  it("引数がある場合は除去しない", () => {
    const argv0 = "/usr/local/bin/hop";

    expect(normalizeCliArgs([argv0, "extra"], argv0, true)).toEqual([argv0, "extra"]);
  });

  it("-- の後ろは予約語でも jump の branch として扱う", () => {
    expect(dispatchCliArgs(["--", "root"], reservedNames)).toEqual({
      kind: "jump",
      args: ["root"],
    });
  });

  it("予約語だけ command に振り分け、それ以外は jump にする", () => {
    expect(dispatchCliArgs(["clean", "--yes"], reservedNames)).toEqual({
      kind: "reserved",
      name: "clean",
      args: ["--yes"],
    });
    expect(dispatchCliArgs(["hop"], reservedNames)).toEqual({
      kind: "jump",
      args: ["hop"],
    });
  });

  it("--help / -h / help を先頭 token で検出する", () => {
    expect(isHelpRequest(["--help"])).toBe(true);
    expect(isHelpRequest(["-h"])).toBe(true);
    expect(isHelpRequest(["help"])).toBe(true);
    expect(isHelpRequest(["help", "--json"])).toBe(true);
  });

  it("hop -- help はエスケープされた branch jump なので help 扱いしない", () => {
    expect(isHelpRequest(["--", "help"])).toBe(false);
    expect(isHelpRequest(["ls"])).toBe(false);
    expect(isHelpRequest([])).toBe(false);
  });
});

import { describe, expect, it } from "bun:test";
import {
  dispatchCliArgs,
  isHelpRequest,
  isUpdateRequest,
  isVersionRequest,
  normalizeCliArgs,
} from "./cli-dispatch.ts";

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

  it("--update の後ろに --help / -h がある場合も help 扱いにする (更新は実行しない)", () => {
    expect(isHelpRequest(["--update", "--help"])).toBe(true);
    expect(isHelpRequest(["--update", "-h"])).toBe(true);
    expect(isHelpRequest(["--update", "--check", "--help"])).toBe(true);
    expect(isHelpRequest(["--update", "--json", "-h"])).toBe(true);
  });

  it("--update に help が無い場合や、--update が先頭でない場合は help 扱いしない", () => {
    expect(isHelpRequest(["--update"])).toBe(false);
    expect(isHelpRequest(["--update", "--check", "--json"])).toBe(false);
    expect(isHelpRequest(["--update", "help"])).toBe(false);
    expect(isHelpRequest(["--", "--update", "--help"])).toBe(false);
    expect(isHelpRequest(["feature", "--help"])).toBe(false);
  });

  it("--update を先頭 token で検出する (後ろのフラグは問わない)", () => {
    expect(isUpdateRequest(["--update"])).toBe(true);
    expect(isUpdateRequest(["--update", "--check", "--json"])).toBe(true);
  });

  it("--update が先頭でない場合は update 扱いしない", () => {
    expect(isUpdateRequest(["--check", "--update"])).toBe(false);
    expect(isUpdateRequest(["ls", "--update"])).toBe(false);
    expect(isUpdateRequest(["--", "--update"])).toBe(false);
    expect(isUpdateRequest(["update"])).toBe(false);
    expect(isUpdateRequest([])).toBe(false);
  });

  it("--version を先頭 token で検出する", () => {
    expect(isVersionRequest(["--version"])).toBe(true);
    expect(isVersionRequest(["--version", "--json"])).toBe(true);
  });

  it("--version が先頭でない場合や別名は version 扱いしない", () => {
    expect(isVersionRequest(["--", "--version"])).toBe(false);
    expect(isVersionRequest(["ls", "--version"])).toBe(false);
    expect(isVersionRequest(["version"])).toBe(false);
    expect(isVersionRequest(["-v"])).toBe(false);
    expect(isVersionRequest([])).toBe(false);
  });

  it("予約語は 5 つのまま増やさない (--update / --version はフラグで、branch 名は衝突しない)", () => {
    expect(dispatchCliArgs(["update"], reservedNames)).toEqual({
      kind: "jump",
      args: ["update"],
    });
    expect(dispatchCliArgs(["version"], reservedNames)).toEqual({
      kind: "jump",
      args: ["version"],
    });
  });
});

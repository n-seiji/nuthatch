import { describe, expect, it } from "bun:test";
import { dispatchCliArgs, normalizeCliArgs } from "./cli-dispatch.ts";

const reservedNames = ["ls", "rm", "clean", "root", "init"];

describe("cli dispatch", () => {
  it("argv0 と同じ引数は stdout が TTY のときだけ除去する", () => {
    const argv0 = "/usr/local/bin/hop";

    expect(normalizeCliArgs([argv0], argv0, true)).toEqual([]);
    expect(normalizeCliArgs([argv0], argv0, false)).toEqual([argv0]);
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
});

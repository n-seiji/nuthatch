import { describe, expect, it } from "bun:test";
import { parseUpstreamStates, upstreamStateOf } from "./upstream.ts";

const line = (refname: string, upstream: string, track: string): string =>
  [refname, upstream, track].join("\0");

describe("parseUpstreamStates", () => {
  it("upstream の ahead / behind / 同期 / gone / 無し を読み分ける", () => {
    const output = [
      line("refs/heads/main", "refs/remotes/origin/main", ""),
      line("refs/heads/feat/a", "refs/remotes/origin/feat/a", "ahead 2"),
      line("refs/heads/feat/b", "refs/remotes/origin/feat/b", "behind 3"),
      line("refs/heads/feat/c", "refs/remotes/origin/feat/c", "ahead 1, behind 4"),
      line("refs/heads/gone", "refs/remotes/origin/gone", "gone"),
      line("refs/heads/local", "", ""),
      "",
    ].join("\n");

    const states = parseUpstreamStates(output);

    expect(states.get("main")).toEqual({ kind: "tracking", ahead: 0, behind: 0 });
    expect(states.get("feat/a")).toEqual({ kind: "tracking", ahead: 2, behind: 0 });
    expect(states.get("feat/b")).toEqual({ kind: "tracking", ahead: 0, behind: 3 });
    expect(states.get("feat/c")).toEqual({ kind: "tracking", ahead: 1, behind: 4 });
    expect(states.get("gone")).toEqual({ kind: "gone" });
    expect(states.get("local")).toEqual({ kind: "none" });
    expect(states.size).toBe(6);
  });

  it("ローカル branch を upstream にしている場合も追跡として扱う", () => {
    const states = parseUpstreamStates(line("refs/heads/topic", "refs/heads/main", "ahead 1"));

    expect(states.get("topic")).toEqual({ kind: "tracking", ahead: 1, behind: 0 });
  });

  it("空の出力は空の map になり、未知の branch は upstream 無しとして扱う", () => {
    const states = parseUpstreamStates("");

    expect(states.size).toBe(0);
    expect(upstreamStateOf(states, "anything")).toEqual({ kind: "none" });
  });
});

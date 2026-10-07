import { describe, expect, it } from "bun:test";
import { npmGlobalPrefixOf } from "./install-script.ts";

describe("npmGlobalPrefixOf", () => {
  it("npm のグローバル配置 (<prefix>/lib/node_modules/@n-seiji/nuthatch/…) の場合、<prefix> を返す", () => {
    for (const [script, prefix] of [
      ["/usr/local/lib/node_modules/@n-seiji/nuthatch/dist/cli.js", "/usr/local"],
      ["/opt/homebrew/lib/node_modules/@n-seiji/nuthatch/dist/cli.js", "/opt/homebrew"],
      [
        "/home/u/.nvm/versions/node/v22.0.0/lib/node_modules/@n-seiji/nuthatch/dist/cli.js",
        "/home/u/.nvm/versions/node/v22.0.0",
      ],
      [
        "/home/u/.local/share/mise/installs/node/25.6.1/lib/node_modules/@n-seiji/nuthatch/dist/cli.js",
        "/home/u/.local/share/mise/installs/node/25.6.1",
      ],
    ] as const) {
      expect(npmGlobalPrefixOf(script)).toBe(prefix);
    }
  });

  it("グローバル配置に見えるだけのパスの場合も、文字列として <prefix> を切り出す (本物かどうかは infra が bin/hop で確かめる)", () => {
    expect(
      npmGlobalPrefixOf("/home/u/repo/packages/lib/node_modules/@n-seiji/nuthatch/dist/cli.js"),
    ).toBe("/home/u/repo/packages");
  });

  it("npm のグローバル配置でないパスの場合、null を返す", () => {
    for (const script of [
      "/home/u/proj/node_modules/@n-seiji/nuthatch/dist/cli.js",
      "/home/u/.bun/install/global/node_modules/@n-seiji/nuthatch/dist/cli.js",
      "/home/u/ghq/github.com/n-seiji/nuthatch/src/cli.ts",
      "/usr/local/lib/node_modules/other-package/dist/cli.js",
    ]) {
      expect(npmGlobalPrefixOf(script)).toBeNull();
    }
  });

  it("<prefix> が空 (ファイルシステムのルート直下) の場合、null を返す", () => {
    expect(npmGlobalPrefixOf("/lib/node_modules/@n-seiji/nuthatch/dist/cli.js")).toBeNull();
  });
});

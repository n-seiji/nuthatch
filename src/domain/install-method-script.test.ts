import { describe, expect, it } from "bun:test";
import { installFactsOf } from "../testing/self-update-port.ts";
import { detectInstallMethod } from "./install-method.ts";

/**
 * What an uncompiled hop running `scriptPath` is classified as.
 * `npmGlobalPrefix` is the fact infra verifies; null unless a test is about npm.
 */
const methodOf = (scriptPath: string, npmGlobalPrefix: string | null = null) =>
  detectInstallMethod(installFactsOf({ scriptPath, npmGlobalPrefix }));

/** The reason an install is refused; throws if it is not refused at all. */
const reasonOf = (scriptPath: string, npmGlobalPrefix: string | null = null): string => {
  const method = methodOf(scriptPath, npmGlobalPrefix);
  if (method.kind !== "unsupported") {
    throw new Error(`expected an unsupported install, got ${method.kind}`);
  }
  return method.reason;
};

describe("detectInstallMethod: npx / bunx", () => {
  it("npx 経由の場合、毎回公開版を取得するので unsupported になる (npm と誤判定しない)", () => {
    const script = "/home/u/.npm/_npx/9f2c1d/node_modules/@n-seiji/nuthatch/dist/cli.js";

    expect(reasonOf(script)).toContain("npx");
  });

  it("bunx 経由の場合、毎回公開版を取得するので unsupported になる (npm と誤判定しない)", () => {
    for (const script of [
      "/tmp/bunx-501-@n-seiji/nuthatch@latest/node_modules/@n-seiji/nuthatch/dist/cli.js",
      "/private/var/folders/xw/jc811drn3gngb6d8t4y5w3lw0000gn/T/bunx-501-@n-seiji/nuthatch@latest/node_modules/@n-seiji/nuthatch/dist/cli.js",
    ]) {
      expect(reasonOf(script)).toContain("bunx");
    }
  });
});

describe("detectInstallMethod: グローバルインストール", () => {
  it("bun のグローバルインストールの場合、npm ではなく bun になる", () => {
    const script = "/home/u/.bun/install/global/node_modules/@n-seiji/nuthatch/dist/cli.js";

    expect(methodOf(script)).toEqual({ kind: "bun" });
  });

  it("npm のグローバル prefix を確認できた場合、置き場が何であれ、その prefix を持つ npm になる", () => {
    for (const [script, prefix] of [
      ["/usr/local/lib/node_modules/@n-seiji/nuthatch/dist/cli.js", "/usr/local"],
      ["/opt/homebrew/lib/node_modules/@n-seiji/nuthatch/dist/cli.js", "/opt/homebrew"],
      [
        "/home/u/.nvm/versions/node/v22.0.0/lib/node_modules/@n-seiji/nuthatch/dist/cli.js",
        "/home/u/.nvm/versions/node/v22.0.0",
      ],
      ["/home/u/.npm-global/lib/node_modules/@n-seiji/nuthatch/dist/cli.js", "/home/u/.npm-global"],
      [
        "/home/u/.local/share/mise/installs/node/25.6.1/lib/node_modules/@n-seiji/nuthatch/dist/cli.js",
        "/home/u/.local/share/mise/installs/node/25.6.1",
      ],
    ] as const) {
      expect(methodOf(script, prefix)).toEqual({ kind: "npm", prefix });
    }
  });

  it("npm のグローバル配置に見えても prefix を確認できない場合、プロジェクト依存として unsupported になる (npm i -g を実行しない)", () => {
    const reason = reasonOf(
      "/home/u/repo/packages/lib/node_modules/@n-seiji/nuthatch/dist/cli.js",
      null,
    );

    expect(reason).toContain("project dependency");
    expect(reason).toContain("update it in that project");
  });
});

describe("detectInstallMethod: npm のグローバル以外の node_modules", () => {
  it("プロジェクトのローカル依存の場合、そのプロジェクトでの更新を案内する unsupported になる", () => {
    const reason = reasonOf("/home/u/proj/node_modules/@n-seiji/nuthatch/dist/cli.js");

    expect(reason).toContain("project dependency");
    expect(reason).toContain("update it in that project");
  });

  it("pnpm のローカル依存 (.pnpm 経由) は、pnpm global と取り違えずプロジェクト依存として扱う", () => {
    const reason = reasonOf(
      "/home/u/proj/node_modules/.pnpm/@n-seiji+nuthatch@0.1.5/node_modules/@n-seiji/nuthatch/dist/cli.js",
    );

    expect(reason).toContain("project dependency");
  });

  it("pnpm のグローバルの場合、pnpm のコマンドを案内する unsupported になる", () => {
    for (const script of [
      "/Users/u/Library/pnpm/global/5/node_modules/.pnpm/@n-seiji+nuthatch@0.1.5/node_modules/@n-seiji/nuthatch/dist/cli.js",
      "/home/u/.local/share/pnpm/global/5/.pnpm/@n-seiji+nuthatch@0.1.5/node_modules/@n-seiji/nuthatch/dist/cli.js",
    ]) {
      expect(reasonOf(script)).toContain('run "pnpm add -g @n-seiji/nuthatch@latest" yourself');
    }
  });

  it("yarn のグローバルの場合、yarn のコマンドを案内する unsupported になる", () => {
    const reason = reasonOf(
      "/home/u/.config/yarn/global/node_modules/@n-seiji/nuthatch/dist/cli.js",
    );

    expect(reason).toContain('run "yarn global add @n-seiji/nuthatch@latest" yourself');
  });
});

describe("detectInstallMethod: ソースチェックアウト", () => {
  it("ソースチェックアウトの場合、git での更新を案内する unsupported になる", () => {
    expect(reasonOf("/home/u/ghq/github.com/n-seiji/nuthatch/src/cli.ts")).toContain(
      "source checkout",
    );
  });

  it("スクリプトの場所も分からない場合、ソースチェックアウト扱いの unsupported になる", () => {
    expect(detectInstallMethod(installFactsOf()).kind).toBe("unsupported");
  });
});

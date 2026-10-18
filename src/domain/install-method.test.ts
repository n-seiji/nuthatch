import { describe, expect, it } from "bun:test";
import {
  type InstallFacts,
  detectInstallMethod,
  suggestedCommand,
  updateHint,
} from "./install-method.ts";

const compiledAt = (path: string, overrides: Partial<InstallFacts> = {}): InstallFacts => ({
  compiled: true,
  executablePath: path,
  scriptPath: null,
  platform: "darwin",
  arch: "arm64",
  ...overrides,
});

const scriptAt = (path: string | null): InstallFacts => ({
  compiled: false,
  executablePath: null,
  scriptPath: path,
  platform: "darwin",
  arch: "arm64",
});

describe("detectInstallMethod", () => {
  it("install.sh が置く場所のコンパイル済みバイナリの場合、standalone とその置き換え先を返す", () => {
    expect(detectInstallMethod(compiledAt("/home/u/.local/bin/hop"))).toEqual({
      kind: "standalone",
      binaryPath: "/home/u/.local/bin/hop",
      installDir: "/home/u/.local/bin",
      assetName: "hop-darwin-arm64",
    });
  });

  it("プラットフォームごとに対応する release asset 名を選ぶ", () => {
    const linux = detectInstallMethod(compiledAt("/u/hop", { platform: "linux", arch: "x64" }));
    expect(linux).toMatchObject({
      kind: "standalone",
      assetName: "hop-linux-x64",
    });
  });

  it("ビルド済みバイナリの無いプラットフォームの場合、other になる", () => {
    const facts = compiledAt("/u/hop", { platform: "linux", arch: "arm64" });
    expect(detectInstallMethod(facts)).toEqual({ kind: "other" });
  });

  it("mise の installs 配下の場合、バイナリでもスクリプトでも mise になる", () => {
    const dir = "/home/u/.local/share/mise/installs/github-n-seiji-nuthatch/0.1.4";
    expect(detectInstallMethod(compiledAt(`${dir}/hop`)).kind).toBe("mise");
    expect(detectInstallMethod(scriptAt(`${dir}/node_modules/x/dist/cli.js`)).kind).toBe("mise");
  });

  it("node_modules 配下のスクリプト (npm / bun のグローバル、npx) の場合、package-manager になる", () => {
    for (const path of [
      "/usr/local/lib/node_modules/@n-seiji/nuthatch/dist/cli.js",
      "/home/u/.bun/install/global/node_modules/@n-seiji/nuthatch/dist/cli.js",
      "/home/u/.npm/_npx/ab/node_modules/@n-seiji/nuthatch/dist/cli.js",
    ]) {
      expect(detectInstallMethod(scriptAt(path)).kind).toBe("package-manager");
    }
  });

  it("Homebrew / Nix / aqua / proto / その他バージョンマネージャ配下のバイナリの場合、other になる", () => {
    for (const path of [
      "/opt/homebrew/Cellar/hop/0.1.4/bin/hop",
      "/nix/store/abc-hop/bin/hop",
      "/home/u/.local/share/aquaproj-aqua/pkgs/x/hop",
      "/home/u/.proto/tools/hop/0.1.4/hop",
      "/home/u/.asdf/installs/hop/0.1.4/bin/hop",
    ]) {
      expect(detectInstallMethod(compiledAt(path))).toEqual({ kind: "other" });
    }
  });

  it("ソースチェックアウトや実行パスが分からない場合、other になる", () => {
    expect(detectInstallMethod(scriptAt("/home/u/nuthatch/src/cli.ts"))).toEqual({
      kind: "other",
    });
    expect(detectInstallMethod(scriptAt(null))).toEqual({ kind: "other" });
  });
});

describe("updateHint / suggestedCommand", () => {
  it("method ごとに 1 行の案内と、案内するコマンドを返す", () => {
    expect(updateHint("mise")).toBe("Update with mise: mise upgrade");
    expect(suggestedCommand("mise")).toEqual(["mise", "upgrade"]);
    expect(updateHint("package-manager")).toBe(
      "Update with your package manager, e.g. npm i -g @n-seiji/nuthatch@latest",
    );
    expect(suggestedCommand("package-manager")).toEqual([
      "npm",
      "i",
      "-g",
      "@n-seiji/nuthatch@latest",
    ]);
    expect(updateHint("other")).toBe("Update hop with the tool you installed it with.");
    expect(suggestedCommand("other")).toBeNull();
  });
});

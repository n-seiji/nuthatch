import { describe, expect, it } from "bun:test";
import { installFactsOf } from "../testing/self-update-port.ts";
import {
  type InstallFacts,
  detectInstallMethod,
  latestChannel,
  preferredProgramDir,
  releaseAssetName,
  upgradeCommand,
} from "./install-method.ts";
import type { MiseToolFacts } from "./mise-tool.ts";

const INSTALLS = "/home/u/.local/share/mise/installs";

/** A mise tool dir named `name` whose marker records `backend` (null: no readable marker). */
const miseDir = (name: string, backend: string | null): MiseToolFacts => ({
  dir: `${INSTALLS}/${name}`,
  backend,
});

/** The reason an install is refused; throws if it is not refused at all. */
const reasonOf = (value: InstallFacts): string => {
  const method = detectInstallMethod(value);
  if (method.kind !== "unsupported") {
    throw new Error(`expected an unsupported install, got ${method.kind}`);
  }
  return method.reason;
};

describe("detectInstallMethod: mise が hop を入れた場合", () => {
  it("mise の GitHub バックエンド配下の場合、GitHub を最新版の取得元にした mise になる", () => {
    const method = detectInstallMethod(
      installFactsOf({
        compiled: true,
        executablePath: "/m/hop",
        mise: miseDir("github-n-seiji-nuthatch", "github:n-seiji/nuthatch"),
      }),
    );

    expect(method).toEqual({
      kind: "mise",
      tool: "github:n-seiji/nuthatch",
      channel: "github",
    });
  });

  it("mise の npm バックエンド配下の場合、npm を最新版の取得元にした mise になる", () => {
    const method = detectInstallMethod(
      installFactsOf({
        scriptPath: `${INSTALLS}/npm-n-seiji-nuthatch/0.1.5/lib/node_modules/@n-seiji/nuthatch/dist/cli.js`,
        mise: miseDir("npm-n-seiji-nuthatch", "npm:@n-seiji/nuthatch"),
      }),
    );

    expect(method).toEqual({
      kind: "mise",
      tool: "npm:@n-seiji/nuthatch",
      channel: "npm",
    });
  });

  it("mise の ubi / aqua バックエンドの場合、GitHub を最新版の取得元にする", () => {
    for (const tool of ["ubi:n-seiji/nuthatch", "aqua:n-seiji/nuthatch"]) {
      const method = detectInstallMethod(installFactsOf({ mise: miseDir("hop", tool) }));

      expect(method).toEqual({ kind: "mise", tool, channel: "github" });
    }
  });

  it("ディレクトリ名が hop らしくなくても (別名 hop で追加)、マーカーが hop を指していれば mise になる", () => {
    const method = detectInstallMethod(
      installFactsOf({ mise: miseDir("hop", "github:n-seiji/nuthatch") }),
    );

    expect(method.kind).toBe("mise");
  });

  it("hop を指すが GitHub / npm 以外のバックエンドの場合、mise upgrade を案内する unsupported になる", () => {
    const reason = reasonOf(
      installFactsOf({
        mise: miseDir("asdf-n-seiji-nuthatch", "asdf:n-seiji/nuthatch"),
      }),
    );

    expect(reason).toContain("mise upgrade asdf:n-seiji/nuthatch");
  });

  it("マーカーの backend に [bin=hop] のようなオプションが付いていても、オプションを除いた id で mise になる (mise upgrade にも渡さない)", () => {
    for (const [backend, tool, channel] of [
      ["github:n-seiji/nuthatch[bin=hop]", "github:n-seiji/nuthatch", "github"],
      ["npm:@n-seiji/nuthatch[a=b]", "npm:@n-seiji/nuthatch", "npm"],
    ] as const) {
      const method = detectInstallMethod(
        installFactsOf({
          compiled: true,
          executablePath: "/m/hop",
          mise: miseDir("github-n-seiji-nuthatch", backend),
        }),
      );

      expect(method).toEqual({ kind: "mise", tool, channel });
      if (method.kind === "mise") {
        expect(upgradeCommand(method)).toEqual(["mise", "upgrade", tool]);
      }
    }
  });

  it("hop を指すが GitHub / npm 以外のバックエンドにオプションが付いている場合も、案内するコマンドにはオプションを含めない", () => {
    const reason = reasonOf(
      installFactsOf({
        mise: miseDir("asdf-n-seiji-nuthatch", "asdf:n-seiji/nuthatch[x=y]"),
      }),
    );

    expect(reason).toContain('"mise upgrade asdf:n-seiji/nuthatch"');
    expect(reason).not.toContain("[x=y]");
  });

  it("コンパイル済みでも mise 配下なら standalone ではなく mise になる", () => {
    const method = detectInstallMethod(
      installFactsOf({
        compiled: true,
        executablePath: "/m/hop",
        mise: miseDir("github-n-seiji-nuthatch", "github:n-seiji/nuthatch"),
      }),
    );

    expect(method.kind).toBe("mise");
  });
});

describe("detectInstallMethod: standalone", () => {
  it("コンパイル済みバイナリが対応プラットフォームの場合、置換先と asset 名を持つ standalone になる", () => {
    const method = detectInstallMethod(
      installFactsOf({
        compiled: true,
        executablePath: "/home/u/.local/bin/hop",
      }),
    );

    expect(method).toEqual({
      kind: "standalone",
      binaryPath: "/home/u/.local/bin/hop",
      installDir: "/home/u/.local/bin",
      assetName: "hop-darwin-arm64",
    });
  });

  it("コンパイル済みバイナリが事前ビルドの無いプラットフォームの場合、npm を案内する unsupported になる", () => {
    const reason = reasonOf(
      installFactsOf({
        compiled: true,
        executablePath: "/home/u/.local/bin/hop",
        platform: "linux",
        arch: "arm64",
      }),
    );

    expect(reason).toMatch(/linux-arm64.*npm/u);
  });

  it("コンパイル済みなのにバイナリの場所が分からない場合、unsupported になる", () => {
    expect(detectInstallMethod(installFactsOf({ compiled: true })).kind).toBe("unsupported");
  });

  it("パッケージ管理ツールの置き場 (Homebrew / Nix / aqua / proto) 配下のバイナリの場合、standalone にせず、そのツールを案内する unsupported になる", () => {
    for (const [path, manager] of [
      ["/opt/homebrew/Cellar/nuthatch/0.1.5/bin/hop", "Homebrew"],
      ["/opt/homebrew/Caskroom/nuthatch/0.1.5/hop", "Homebrew"],
      ["/nix/store/abc123-nuthatch-0.1.5/bin/hop", "Nix"],
      ["/home/u/.local/share/aquaproj-aqua/pkgs/github_release/hop", "aqua"],
      ["/home/u/.proto/tools/hop/0.1.5/hop", "proto"],
    ] as const) {
      const reason = reasonOf(installFactsOf({ compiled: true, executablePath: path }));

      expect(reason).toContain(manager);
      expect(reason).toContain(path);
    }
  });

  it("Homebrew の formula が std_npm_args で入れた script (Cellar/<formula>/<version>/libexec の npm prefix) の場合、検証済みの prefix でも npm にせず、brew upgrade を案内する unsupported になる", () => {
    const prefix = "/opt/homebrew/Cellar/nuthatch/0.1.5/libexec";
    const reason = reasonOf(
      installFactsOf({
        scriptPath: `${prefix}/lib/node_modules/@n-seiji/nuthatch/dist/cli.js`,
        npmGlobalPrefix: prefix,
      }),
    );

    expect(reason).toContain("Homebrew");
    expect(reason).toContain(prefix);
    expect(reason).toContain('"brew upgrade"');
  });

  it("Nix のストアにある script の場合も、検証済みの npm prefix を npm にせず、Nix を案内する unsupported になる", () => {
    const prefix = "/nix/store/abc123-nuthatch-0.1.5";
    const reason = reasonOf(
      installFactsOf({
        scriptPath: `${prefix}/lib/node_modules/@n-seiji/nuthatch/dist/cli.js`,
        npmGlobalPrefix: prefix,
      }),
    );

    expect(reason).toContain("Nix");
    expect(reason).toContain(prefix);
  });
});

describe("releaseAssetName", () => {
  it("リリースに添付されているプラットフォームの場合、hop-<os>-<arch> を返す", () => {
    expect(releaseAssetName("darwin", "arm64")).toBe("hop-darwin-arm64");
    expect(releaseAssetName("darwin", "x64")).toBe("hop-darwin-x64");
    expect(releaseAssetName("linux", "x64")).toBe("hop-linux-x64");
  });

  it("バイナリの無いプラットフォームの場合、null を返す", () => {
    expect(releaseAssetName("linux", "arm64")).toBeNull();
    expect(releaseAssetName("win32", "x64")).toBeNull();
  });
});

describe("upgradeCommand", () => {
  it("mise の場合、mise upgrade <tool> を返す", () => {
    expect(
      upgradeCommand({
        kind: "mise",
        tool: "github:n-seiji/nuthatch",
        channel: "github",
      }),
    ).toEqual(["mise", "upgrade", "github:n-seiji/nuthatch"]);
  });

  it("npm の場合、hop が入っている prefix を --prefix で指定した npm install -g を返す", () => {
    expect(upgradeCommand({ kind: "npm", prefix: "/opt/homebrew" })).toEqual([
      "npm",
      "install",
      "-g",
      "--prefix",
      "/opt/homebrew",
      "@n-seiji/nuthatch@latest",
    ]);
  });

  it("bun の場合、bun add -g <package>@latest を返す", () => {
    expect(upgradeCommand({ kind: "bun" })).toEqual([
      "bun",
      "add",
      "-g",
      "@n-seiji/nuthatch@latest",
    ]);
  });
});

describe("latestChannel", () => {
  it("取得元は install 方法ごとに決まる", () => {
    expect(
      latestChannel({
        kind: "standalone",
        binaryPath: "/b/hop",
        installDir: "/b",
        assetName: "a",
      }),
    ).toBe("github");
    expect(latestChannel({ kind: "npm", prefix: "/usr/local" })).toBe("npm");
    expect(latestChannel({ kind: "bun" })).toBe("npm");
    expect(latestChannel({ kind: "mise", tool: "npm:x", channel: "npm" })).toBe("npm");
    expect(latestChannel({ kind: "mise", tool: "github:x/y", channel: "github" })).toBe("github");
  });
});

describe("preferredProgramDir", () => {
  it("npm の場合、hop が入っている prefix の bin を返す (その prefix の npm で更新するため)", () => {
    expect(preferredProgramDir({ kind: "npm", prefix: "/opt/homebrew" })).toBe("/opt/homebrew/bin");
  });

  it("mise / bun の場合、null を返す (PATH だけで探す)", () => {
    expect(
      preferredProgramDir({ kind: "mise", tool: "github:n-seiji/nuthatch", channel: "github" }),
    ).toBeNull();
    expect(preferredProgramDir({ kind: "bun" })).toBeNull();
  });
});

import { describe, expect, it } from "bun:test";
import {
  isHopBackend,
  isHopToolDirName,
  miseToolDir,
  parseLegacyMiseBackend,
  parseMiseBackendToml,
  withoutToolOptions,
} from "./mise-tool.ts";

describe("parseMiseBackendToml", () => {
  it("mise の .mise.backend.toml の場合、full の値を返す", () => {
    const toml = [
      'short = "github:n-seiji/nuthatch"',
      'full = "github:n-seiji/nuthatch"',
      "explicit_backend = true",
    ].join("\n");

    expect(parseMiseBackendToml(toml)).toBe("github:n-seiji/nuthatch");
  });

  it("short と full が異なる場合、full を返す", () => {
    const toml = 'short = "claude-code"\nfull = "npm:@anthropic-ai/claude-code"\n';

    expect(parseMiseBackendToml(toml)).toBe("npm:@anthropic-ai/claude-code");
  });

  it("node の実際のマーカーの場合、別ツールの full (core:node) をそのまま返す", () => {
    const toml = 'short = "node"\nfull = "core:node"\nexplicit_backend = true';

    expect(parseMiseBackendToml(toml)).toBe("core:node");
  });

  it("CRLF 改行でも full を返す", () => {
    expect(parseMiseBackendToml('short = "a"\r\nfull = "npm:x"\r\n')).toBe("npm:x");
  });

  it("full が無い・空の場合、null を返す", () => {
    expect(parseMiseBackendToml('short = "a"\n')).toBeNull();
    expect(parseMiseBackendToml('full = ""\n')).toBeNull();
    expect(parseMiseBackendToml("")).toBeNull();
  });
});

describe("parseLegacyMiseBackend", () => {
  it("short と full が同じ 2 行 (明示バックエンド) の場合、full を返す", () => {
    expect(parseLegacyMiseBackend("npm:@n-seiji/nuthatch\nnpm:@n-seiji/nuthatch")).toBe(
      "npm:@n-seiji/nuthatch",
    );
  });

  it("1 行目が別名 (short) の場合も、最後の行の full を返す", () => {
    // The real file for a tool added as `claude-code`.
    expect(parseLegacyMiseBackend("claude-code\nnpm:@anthropic-ai/claude-code\n")).toBe(
      "npm:@anthropic-ai/claude-code",
    );
    expect(parseLegacyMiseBackend("node\ncore:node")).toBe("core:node");
  });

  it("1 行だけでも、CRLF や前後の空白・空行があっても、その full を返す", () => {
    expect(parseLegacyMiseBackend("github:n-seiji/nuthatch")).toBe("github:n-seiji/nuthatch");
    expect(parseLegacyMiseBackend("hop\r\n  github:n-seiji/nuthatch  \r\n\r\n")).toBe(
      "github:n-seiji/nuthatch",
    );
  });

  it("空の場合、null を返す", () => {
    expect(parseLegacyMiseBackend("")).toBeNull();
    expect(parseLegacyMiseBackend("  \n\r\n")).toBeNull();
  });
});

describe("withoutToolOptions", () => {
  it("末尾に [key=value,…] のオプションが付いている場合、それを除いた id を返す", () => {
    expect(withoutToolOptions("github:n-seiji/nuthatch[bin=hop]")).toBe("github:n-seiji/nuthatch");
    expect(withoutToolOptions("npm:@n-seiji/nuthatch[a=b,c=d]")).toBe("npm:@n-seiji/nuthatch");
  });

  it("オプションが無い・末尾でない [] の場合、そのまま返す", () => {
    expect(withoutToolOptions("github:n-seiji/nuthatch")).toBe("github:n-seiji/nuthatch");
    expect(withoutToolOptions("core:node")).toBe("core:node");
    expect(withoutToolOptions("a[b]c")).toBe("a[b]c");
  });
});

describe("isHopBackend", () => {
  it("hop のリポジトリ / パッケージを指す backend の場合、バックエンドの種類を問わず true を返す", () => {
    for (const backend of [
      "github:n-seiji/nuthatch",
      "ubi:n-seiji/nuthatch",
      "aqua:n-seiji/nuthatch",
      "npm:@n-seiji/nuthatch",
      "asdf:n-seiji/nuthatch",
      "GitHub:N-Seiji/Nuthatch",
    ]) {
      expect(isHopBackend(backend)).toBe(true);
    }
  });

  it("別のツールを指す backend の場合、false を返す (hop がその中にいるだけのケース)", () => {
    for (const backend of [
      "core:node",
      "core:bun",
      "node",
      "npm:nuthatch",
      "github:other/nuthatch",
      "github:n-seiji/nuthatch-fork",
      "github:n-seiji/nuthatch/extra",
      "npm:@other/n-seiji/nuthatch",
      "go:github.com/n-seiji/nuthatch",
      "n-seiji/nuthatch",
      "",
    ]) {
      expect(isHopBackend(backend)).toBe(false);
    }
  });
});

describe("isHopToolDirName", () => {
  it("明示バックエンドで入れた hop のディレクトリ名の場合、true を返す", () => {
    for (const name of [
      "github-n-seiji-nuthatch",
      "npm-n-seiji-nuthatch",
      "ubi-n-seiji-nuthatch",
      "n-seiji-nuthatch",
    ]) {
      expect(isHopToolDirName(name)).toBe(true);
    }
  });

  it("他のツールのディレクトリ名の場合、false を返す", () => {
    for (const name of [
      "node",
      "nodejs",
      "nuthatch",
      "hop",
      "github-n-seiji-nuthatch-fork",
      "xn-seiji-nuthatch",
      "",
    ]) {
      expect(isHopToolDirName(name)).toBe(false);
    }
  });
});

describe("miseToolDir", () => {
  const INSTALLS = "/home/u/.local/share/mise/installs";

  it("GitHub バックエンドのバイナリの場合、installs 直下のツールディレクトリを返す", () => {
    expect(miseToolDir(`${INSTALLS}/github-n-seiji-nuthatch/0.1.4/hop`)).toBe(
      `${INSTALLS}/github-n-seiji-nuthatch`,
    );
  });

  it("npm バックエンドの深い配置 (7 階層上) でも、ツールディレクトリを返す", () => {
    const script = `${INSTALLS}/npm-n-seiji-nuthatch/0.1.5/lib/node_modules/@n-seiji/nuthatch/dist/cli.js`;

    expect(miseToolDir(script)).toBe(`${INSTALLS}/npm-n-seiji-nuthatch`);
  });

  it("mise の node 配下に npm i -g した hop の場合、node のツールディレクトリを返す", () => {
    const script = `${INSTALLS}/node/25.6.1/lib/node_modules/@n-seiji/nuthatch/dist/cli.js`;

    expect(miseToolDir(script)).toBe(`${INSTALLS}/node`);
  });

  it("ツールディレクトリが 8 階層上までなら返し、9 階層以上上なら null を返す", () => {
    const eighth = `${INSTALLS}/tool/a/b/c/d/e/f/g/hop`;
    const ninth = `${INSTALLS}/tool/a/b/c/d/e/f/g/h/hop`;

    expect(miseToolDir(eighth)).toBe(`${INSTALLS}/tool`);
    expect(miseToolDir(ninth)).toBeNull();
  });

  it("installs が入れ子の場合、最も近いツールディレクトリだけを返す", () => {
    const nested = `${INSTALLS}/github-n-seiji-nuthatch/0.1.4/x/installs/node/25/bin/hop`;

    expect(miseToolDir(nested)).toBe(`${INSTALLS}/github-n-seiji-nuthatch/0.1.4/x/installs/node`);
  });

  it("親が installs でないパスの場合、null を返す", () => {
    expect(miseToolDir("/home/u/ghq/github.com/n-seiji/nuthatch/src/cli.ts")).toBeNull();
    expect(miseToolDir("/installs")).toBeNull();
    expect(miseToolDir("hop")).toBeNull();
  });
});

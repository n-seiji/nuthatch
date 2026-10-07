import { describe, expect, it } from "bun:test";
import {
  GITHUB_LATEST_RELEASE_URL,
  NPM_LATEST_URL,
  compareVersions,
  isWriteDenied,
  parseChecksumFile,
  pathExecutableCandidates,
  releaseAssetUrl,
  requireVersion,
  versionFromTag,
} from "./self-update.ts";

const HEX = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

const errorWithCode = (code: string): Error => Object.assign(new Error(code), { code });

describe("compareVersions", () => {
  it("同じバージョンの場合、0 を返す", () => {
    expect(compareVersions("0.1.5", "0.1.5")).toBe(0);
  });

  it("新しい方が大きい場合、正の数を返し、逆なら負の数を返す", () => {
    expect(compareVersions("0.1.5", "0.1.4")).toBeGreaterThan(0);
    expect(compareVersions("0.1.4", "0.1.5")).toBeLessThan(0);
  });

  it("各桁は数値で比較する (文字列順にしない)", () => {
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
    expect(compareVersions("0.1.10", "0.1.9")).toBeGreaterThan(0);
  });

  it("x.y.z として読めない場合、推測せずエラーにする", () => {
    for (const bad of ["latest", "1.2", "1.2.3.4", "1.2.3-rc.1", "v1.2.3", "", "1.2.x"]) {
      expect(() => compareVersions(bad, "1.0.0")).toThrow(/x\.y\.z/u);
      expect(() => compareVersions("1.0.0", bad)).toThrow(/x\.y\.z/u);
    }
  });
});

describe("versionFromTag", () => {
  it("v 付きのタグの場合、v を外したバージョンを返す", () => {
    expect(versionFromTag("v0.1.4")).toBe("0.1.4");
  });

  it("v の無いタグや x.y.z でないタグの場合、エラーにする", () => {
    for (const bad of ["0.1.4", "v0.1", "release-1", "v1.2.3-rc.1", ""]) {
      expect(() => versionFromTag(bad)).toThrow(/release tag/u);
    }
  });
});

describe("requireVersion", () => {
  it("x.y.z の場合、そのまま返す", () => {
    expect(requireVersion("0.1.4")).toBe("0.1.4");
  });

  it("x.y.z でない場合、エラーにする", () => {
    expect(() => requireVersion("0.1.4-beta.1")).toThrow(/x\.y\.z/u);
  });
});

describe("parseChecksumFile", () => {
  const ASSET = "hop-linux-x64";
  const digestOf = (text: string) => parseChecksumFile(text, ASSET);

  it("sha256sum の出力 (<hex>  out/hop-linux-x64 + 改行) の場合、先頭トークンの hex を返す", () => {
    expect(digestOf(`${HEX}  out/hop-linux-x64\n`)).toEqual({ ok: true, digest: HEX });
  });

  it("大文字の hex の場合、小文字に揃えて返す", () => {
    expect(digestOf(`${HEX.toUpperCase()}  ${ASSET}\n`)).toEqual({ ok: true, digest: HEX });
  });

  it("hex だけ (ファイル名なし)・前後に空白や空行がある場合でも、hex を返す", () => {
    expect(digestOf(HEX)).toEqual({ ok: true, digest: HEX });
    expect(digestOf(`\n  ${HEX}\n\n`)).toEqual({ ok: true, digest: HEX });
  });

  it("ファイル名が asset 名そのもの・バイナリモードの * 付きでも、hex を返す", () => {
    expect(digestOf(`${HEX} ${ASSET}`)).toEqual({ ok: true, digest: HEX });
    expect(digestOf(`\n  ${HEX} *out/${ASSET}\n\n`)).toEqual({ ok: true, digest: HEX });
  });

  it("ファイル名が別の asset を指している場合、ファイル名と asset 名を含む理由で検証できないとする", () => {
    for (const file of [
      "out/hop-darwin-arm64",
      "hop",
      "out/xhop-linux-x64",
      "out/hop-linux-x64.tar",
      "hop-linux-x64/hop",
    ]) {
      const parsed = digestOf(`${HEX}  ${file}\n`);

      expect(parsed).toEqual({ ok: false, reason: expect.stringContaining(`"${file}"`) });
      expect(parsed.ok ? "" : parsed.reason).toContain(ASSET);
    }
  });

  it("先頭トークンしか見ない (2 行目以降の hex は採用しない)", () => {
    expect(digestOf(`not-a-hash\n${HEX}  ${ASSET}\n`)).toEqual({
      ok: false,
      reason: expect.stringContaining("malformed"),
    });
  });

  it("64 桁の hex でない場合、malformed として検証できないとする", () => {
    for (const text of [
      "",
      "   \n",
      `${HEX.slice(1)}  ${ASSET}`,
      `${HEX}0  ${ASSET}`,
      `${"g".repeat(64)}  ${ASSET}`,
      "<html>404</html>",
    ]) {
      expect(digestOf(text)).toEqual({ ok: false, reason: expect.stringContaining("malformed") });
    }
  });
});

describe("pathExecutableCandidates", () => {
  it("PATH の絶対パスエントリを順番どおりに <dir>/<name> へ展開する", () => {
    expect(pathExecutableCandidates("mise", "/opt/bin:/usr/local/bin")).toEqual([
      "/opt/bin/mise",
      "/usr/local/bin/mise",
    ]);
  });

  it("相対パス・空のエントリは候補にしない (cwd 依存の実行を防ぐ)", () => {
    expect(pathExecutableCandidates("npm", "node_modules/.bin:.::/opt/bin")).toEqual([
      "/opt/bin/npm",
    ]);
  });

  it("重複は先に出た順で 1 度だけ、末尾スラッシュは二重にしない", () => {
    expect(pathExecutableCandidates("bun", "/a/:/b:/a:/")).toEqual(["/a/bun", "/b/bun", "/bun"]);
  });

  it("PATH が未設定・空の場合、候補なしを返す (既知の場所への fallback はしない)", () => {
    expect(pathExecutableCandidates("mise")).toEqual([]);
    expect(pathExecutableCandidates("mise", "")).toEqual([]);
  });

  it("優先ディレクトリがある場合、PATH より先に並べる (PATH にも同じ場所があれば 1 度だけ)", () => {
    expect(pathExecutableCandidates("npm", "/usr/bin:/opt/bin", "/p/bin")).toEqual([
      "/p/bin/npm",
      "/usr/bin/npm",
      "/opt/bin/npm",
    ]);
    expect(pathExecutableCandidates("npm", "/usr/bin:/p/bin", "/p/bin")).toEqual([
      "/p/bin/npm",
      "/usr/bin/npm",
    ]);
  });

  it("優先ディレクトリが絶対パスでない・null の場合、PATH だけから候補を作る", () => {
    expect(pathExecutableCandidates("npm", "/usr/bin", "relative/bin")).toEqual(["/usr/bin/npm"]);
    expect(pathExecutableCandidates("npm", "/usr/bin", null)).toEqual(["/usr/bin/npm"]);
  });

  it("PATH が空でも、優先ディレクトリの候補は返す", () => {
    expect(pathExecutableCandidates("npm", "", "/p/bin")).toEqual(["/p/bin/npm"]);
  });
});

describe("isWriteDenied", () => {
  it("EACCES / EPERM / EROFS (権限なし・読み取り専用ファイルシステム) の fs エラーの場合、true を返す", () => {
    expect(isWriteDenied(errorWithCode("EACCES"))).toBe(true);
    expect(isWriteDenied(errorWithCode("EPERM"))).toBe(true);
    expect(isWriteDenied(errorWithCode("EROFS"))).toBe(true);
  });

  it("それ以外のエラーや、エラーでない値の場合、false を返す", () => {
    expect(isWriteDenied(errorWithCode("ENOSPC"))).toBe(false);
    expect(isWriteDenied(new Error("EACCES"))).toBe(false);
    expect(isWriteDenied("EACCES")).toBe(false);
    expect(isWriteDenied(null)).toBe(false);
  });
});

describe("release URLs", () => {
  it("最新版の取得元は固定の HTTPS URL である", () => {
    expect(GITHUB_LATEST_RELEASE_URL).toBe(
      "https://api.github.com/repos/n-seiji/nuthatch/releases/latest",
    );
    expect(NPM_LATEST_URL).toBe("https://registry.npmjs.org/@n-seiji%2Fnuthatch/latest");
  });

  it("asset は latest/download ではなく、解決済みのタグ (v<version>) から取得する", () => {
    expect(releaseAssetUrl("0.1.5", "hop-linux-x64")).toBe(
      "https://github.com/n-seiji/nuthatch/releases/download/v0.1.5/hop-linux-x64",
    );
    expect(releaseAssetUrl("0.1.5", "hop-linux-x64.sha256")).toBe(
      "https://github.com/n-seiji/nuthatch/releases/download/v0.1.5/hop-linux-x64.sha256",
    );
  });
});

import { describe, expect, it } from "bun:test";
import type { StandaloneMethod } from "../domain/install-method.ts";
import type { SelfUpdatePort } from "../domain/ports.ts";
import { EXIT_GENERAL_ERROR, EXIT_SAFE_REJECTION, EXIT_SUCCESS } from "../domain/result.ts";
import { createFakeSelfUpdate, updateDataOf } from "../testing/self-update-port.ts";
import { replaceStandalone } from "./self-update-standalone.ts";

const method: StandaloneMethod = {
  kind: "standalone",
  binaryPath: "/home/u/.local/bin/hop",
  installDir: "/home/u/.local/bin",
  assetName: "hop-darwin-arm64",
};
const DIGEST = "ab".repeat(32);
const OTHER_DIGEST = "cd".repeat(32);
const NEW_BINARY = new TextEncoder().encode("new binary");

interface Replacement {
  readonly path: string;
  readonly bytes: Uint8Array;
}

/** A port whose downloads succeed and whose checksum file says `expected`. */
const portFor = (expected: string, overrides: Partial<SelfUpdatePort> = {}) => {
  const replaced: Replacement[] = [];
  const downloads: string[] = [];
  const checkedDirs: string[] = [];
  const fake = createFakeSelfUpdate({
    assertWritableDir: (dir) => {
      checkedDirs.push(dir);
      return Promise.resolve();
    },
    downloadReleaseText: (version, name) => {
      downloads.push(`text ${version} ${name}`);
      return Promise.resolve(`${expected}  out/hop-darwin-arm64\n`);
    },
    downloadReleaseAsset: (version, name) => {
      downloads.push(`asset ${version} ${name}`);
      return Promise.resolve(NEW_BINARY);
    },
    sha256Hex: () => DIGEST,
    replaceExecutable: (path, bytes) => {
      replaced.push({ path, bytes });
      return Promise.resolve();
    },
    ...overrides,
  });
  return { fake, replaced, downloads, checkedDirs };
};

describe("replaceStandalone", () => {
  it("検証に通った場合、対象バイナリを検証済みのバイトで置換し action: replaced を返す", async () => {
    const { fake, replaced, downloads } = portFor(DIGEST);

    const result = await replaceStandalone(fake.port, fake.term, method, updateDataOf());

    expect(result).toMatchObject({ ok: true, exitCode: EXIT_SUCCESS });
    expect(result.data).toEqual(updateDataOf({ action: "replaced" }));
    expect(replaced).toEqual([{ path: "/home/u/.local/bin/hop", bytes: NEW_BINARY }]);
    expect(downloads).toEqual([
      "text 0.1.5 hop-darwin-arm64.sha256",
      "asset 0.1.5 hop-darwin-arm64",
    ]);
  });

  it("置換は検証の後に行う (書き込み確認 → チェックサム → 本体 → 検証 → 置換の順)", async () => {
    const { fake, checkedDirs } = portFor(DIGEST);

    await replaceStandalone(fake.port, fake.term, method, updateDataOf());

    expect(checkedDirs).toEqual(["/home/u/.local/bin"]);
    expect(fake.calls).toEqual([
      "assertWritableDir",
      "downloadReleaseText",
      "downloadReleaseAsset",
      "sha256Hex",
      "replaceExecutable",
    ]);
  });

  it("チェックサムファイルが大文字 hex でも、小文字として照合する", async () => {
    const { fake, replaced } = portFor(DIGEST.toUpperCase());

    const result = await replaceStandalone(fake.port, fake.term, method, updateDataOf());

    expect(result.ok).toBe(true);
    expect(replaced).toHaveLength(1);
  });

  it("チェックサムが一致しない場合、exit 3 で拒否し、何も置換しない", async () => {
    const { fake, replaced } = portFor(OTHER_DIGEST);

    const result = await replaceStandalone(fake.port, fake.term, method, updateDataOf());

    expect(result).toMatchObject({ ok: false, exitCode: EXIT_SAFE_REJECTION });
    expect(result.errorMessage).toContain("Checksum mismatch");
    expect(result.errorMessage).toContain(OTHER_DIGEST);
    expect(result.errorMessage).toContain(DIGEST);
    expect(result.data).toBeUndefined();
    expect(replaced).toEqual([]);
    expect(fake.calls).not.toContain("replaceExecutable");
  });

  it("チェックサムファイルが読めない形式の場合、検証できないので exit 3 で拒否し、何も置換しない", async () => {
    const { fake, replaced } = portFor("<html>not a checksum</html>");

    const result = await replaceStandalone(fake.port, fake.term, method, updateDataOf());

    expect(result).toMatchObject({ ok: false, exitCode: EXIT_SAFE_REJECTION });
    expect(result.errorMessage).toContain("unverified");
    expect(replaced).toEqual([]);
  });

  it("チェックサムファイルが別の asset のファイル名を指している場合、検証できないので exit 3 で拒否し、何も置換しない", async () => {
    const { fake, replaced } = portFor(DIGEST, {
      downloadReleaseText: () => Promise.resolve(`${DIGEST}  out/hop-linux-x64\n`),
    });

    const result = await replaceStandalone(fake.port, fake.term, method, updateDataOf());

    expect(result).toMatchObject({ ok: false, exitCode: EXIT_SAFE_REJECTION });
    expect(result.errorMessage).toContain("hop-darwin-arm64.sha256");
    expect(result.errorMessage).toContain('"out/hop-linux-x64"');
    expect(result.errorMessage).toContain("unverified");
    expect(replaced).toEqual([]);
    expect(fake.calls).not.toContain("replaceExecutable");
  });

  it("チェックサムの取得に失敗した場合、exit 1 になり、本体はダウンロードしない", async () => {
    const { fake } = portFor(DIGEST, {
      downloadReleaseText: () => Promise.reject(new Error("GET https://x failed: HTTP 404")),
    });

    const result = await replaceStandalone(fake.port, fake.term, method, updateDataOf());

    expect(result).toMatchObject({ ok: false, exitCode: EXIT_GENERAL_ERROR });
    expect(result.errorMessage).toContain("hop-darwin-arm64.sha256");
    expect(result.errorMessage).toContain("HTTP 404");
    expect(fake.calls).toEqual(["assertWritableDir", "downloadReleaseText"]);
  });

  it("本体の取得に失敗した場合、exit 1 になり、何も置換しない", async () => {
    const { fake, replaced } = portFor(DIGEST, {
      downloadReleaseAsset: () => Promise.reject(new Error("The operation timed out.")),
    });

    const result = await replaceStandalone(fake.port, fake.term, method, updateDataOf());

    expect(result).toMatchObject({ ok: false, exitCode: EXIT_GENERAL_ERROR });
    expect(result.errorMessage).toContain("timed out");
    expect(replaced).toEqual([]);
  });

  it("書き込めないことが分かっているディレクトリ (EACCES / EPERM / EROFS) の場合、何もダウンロードせずに、書き込み可能な場所への入れ直しを案内して exit 1 になる", async () => {
    for (const code of ["EACCES", "EPERM", "EROFS"]) {
      const { fake, downloads } = portFor(DIGEST, {
        assertWritableDir: () => Promise.reject(Object.assign(new Error(code), { code })),
      });

      // oxlint-disable-next-line no-await-in-loop
      const result = await replaceStandalone(fake.port, fake.term, method, updateDataOf());

      expect(result).toMatchObject({ ok: false, exitCode: EXIT_GENERAL_ERROR });
      expect(result.errorMessage).toBe(
        "Cannot write /home/u/.local/bin; reinstall hop somewhere writable (install.sh uses ~/.local/bin).",
      );
      expect(downloads).toEqual([]);
      expect(fake.calls).toEqual(["assertWritableDir"]);
    }
  });

  it("書き込み確認が権限以外で失敗した場合、対象のパスと原因を含めて exit 1 になり、何もダウンロードしない", async () => {
    const { fake, downloads } = portFor(DIGEST, {
      assertWritableDir: () =>
        Promise.reject(Object.assign(new Error("ENOENT: no such directory"), { code: "ENOENT" })),
    });

    const result = await replaceStandalone(fake.port, fake.term, method, updateDataOf());

    expect(result).toMatchObject({ ok: false, exitCode: EXIT_GENERAL_ERROR });
    expect(result.errorMessage).toContain("/home/u/.local/bin/hop");
    expect(result.errorMessage).toContain("ENOENT");
    expect(downloads).toEqual([]);
  });

  it("置換の直前に書き込めなくなった場合 (EACCES / EPERM / EROFS) も、同じ案内で exit 1 になる", async () => {
    for (const code of ["EACCES", "EPERM", "EROFS"]) {
      const { fake } = portFor(DIGEST, {
        replaceExecutable: () => Promise.reject(Object.assign(new Error(code), { code })),
      });

      // oxlint-disable-next-line no-await-in-loop
      const result = await replaceStandalone(fake.port, fake.term, method, updateDataOf());

      expect(result).toMatchObject({ ok: false, exitCode: EXIT_GENERAL_ERROR });
      expect(result.errorMessage).toBe(
        "Cannot write /home/u/.local/bin; reinstall hop somewhere writable (install.sh uses ~/.local/bin).",
      );
    }
  });

  it("それ以外の置換エラーの場合、対象のパスと原因を含めて exit 1 になる", async () => {
    const { fake } = portFor(DIGEST, {
      replaceExecutable: () => Promise.reject(new Error("ENOSPC: no space left on device")),
    });

    const result = await replaceStandalone(fake.port, fake.term, method, updateDataOf());

    expect(result).toMatchObject({ ok: false, exitCode: EXIT_GENERAL_ERROR });
    expect(result.errorMessage).toContain("/home/u/.local/bin/hop");
    expect(result.errorMessage).toContain("ENOSPC");
  });

  it("進捗を stderr に出す (stdout は使わない)", async () => {
    const { fake } = portFor(DIGEST);

    await replaceStandalone(fake.port, fake.term, method, updateDataOf());

    const logs = fake.logs.join("\n");
    expect(logs).toContain("Downloading hop-darwin-arm64");
    expect(logs).toContain("/home/u/.local/bin/hop");
    expect(logs).toContain("0.1.4 -> 0.1.5");
  });
});

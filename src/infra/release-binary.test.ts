import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { replaceExecutable, sha256Hex } from "./release-binary.ts";

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);
const PERMISSION_BITS = 0o777;

const permissionsOf = async (path: string): Promise<number> => {
  const stats = await stat(path);
  return stats.mode & PERMISSION_BITS;
};

let sandbox: string;

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "nuthatch-release-binary-"));
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

describe("sha256Hex", () => {
  it("既知の入力の場合、小文字 hex の SHA-256 を返す", () => {
    expect(sha256Hex(bytesOf("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Hex(bytesOf(""))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    // Same fixture install.test.ts pins for install.sh's own verification.
    expect(sha256Hex(bytesOf("hop test binary\n"))).toBe(
      "883505c7f3d9694db7d8958ad128c2fdf70d8f57be47e8d918fac547a21d46fc",
    );
  });
});

describe("replaceExecutable", () => {
  it("既存のバイナリの場合、中身を差し替え、実行権 0755 にして、一時ファイルを残さない", async () => {
    const target = join(sandbox, "hop");
    await writeFile(target, "old", { mode: 0o700 });

    await replaceExecutable(target, bytesOf("new binary"));

    expect(await readFile(target, "utf8")).toBe("new binary");
    expect(await permissionsOf(target)).toBe(0o755);
    expect(await readdir(sandbox)).toEqual(["hop"]);
  });

  it("umask が厳しくても 0755 になる (writeFile の mode は umask で削られるため)", async () => {
    const target = join(sandbox, "hop");
    await writeFile(target, "old");

    const previousUmask = process.umask(0o077);
    try {
      await replaceExecutable(target, bytesOf("new binary"));
    } finally {
      process.umask(previousUmask);
    }

    expect(await permissionsOf(target)).toBe(0o755);
  });

  it("symlink 経由の場合、リンク先の実体を差し替え、リンク自体は残す", async () => {
    const realDir = join(sandbox, "real");
    const binDir = join(sandbox, "bin");
    await mkdir(realDir);
    await mkdir(binDir);
    const real = join(realDir, "hop");
    const link = join(binDir, "hop");
    await writeFile(real, "old", { mode: 0o755 });
    await symlink(real, link);

    await replaceExecutable(link, bytesOf("new binary"));

    expect(await readFile(real, "utf8")).toBe("new binary");
    const linkStats = await lstat(link);
    expect(linkStats.isSymbolicLink()).toBe(true);
    expect(await readlink(link)).toBe(real);
    expect(await readdir(realDir)).toEqual(["hop"]);
    expect(await readdir(binDir)).toEqual(["hop"]);
  });

  it("差し替えに失敗した場合、エラーを投げ、一時ファイルを残さない", async () => {
    // Renaming a file over a directory fails after the temp file was written.
    const target = join(sandbox, "hop");
    await mkdir(target);

    await expect(replaceExecutable(target, bytesOf("new binary"))).rejects.toThrow();

    const targetStats = await stat(target);
    expect(await readdir(sandbox)).toEqual(["hop"]);
    expect(targetStats.isDirectory()).toBe(true);
  });

  it("対象が存在しない場合、新規作成せずエラーを投げる", async () => {
    const missing = join(sandbox, "nowhere", "hop");

    await expect(replaceExecutable(missing, bytesOf("new binary"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readdir(sandbox)).toEqual([]);
  });

  // Root ignores directory permission bits, so this cannot fail for it.
  const itUnlessRoot = process.getuid?.() === 0 ? it.skip : it;

  itUnlessRoot(
    "書き込めないディレクトリの場合、code が EACCES のエラーを投げ、元のバイナリを触らない",
    async () => {
      const dir = join(sandbox, "readonly");
      await mkdir(dir);
      const target = join(dir, "hop");
      await writeFile(target, "old", { mode: 0o755 });
      await chmod(dir, 0o555);

      try {
        await expect(replaceExecutable(target, bytesOf("new binary"))).rejects.toMatchObject({
          code: "EACCES",
        });
      } finally {
        await chmod(dir, 0o755);
      }

      expect(await readFile(target, "utf8")).toBe("old");
      expect(await readdir(dir)).toEqual(["hop"]);
    },
  );
});

import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { GIT_NOT_FOUND_ERROR_CODE } from "../domain/git-executable.ts";
import { createGitExecutableResolver } from "./git-executable.ts";

const EXECUTABLE_MODE = 0o755;
const NON_EXECUTABLE_MODE = 0o644;

let sandbox: string;

const makeBin = async (dir: string, mode: number): Promise<string> => {
  const binDir = join(sandbox, dir);
  await mkdir(binDir, { recursive: true });
  const path = join(binDir, "git");
  await writeFile(path, "#!/bin/sh\nexit 0\n");
  await chmod(path, mode);
  return path;
};

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "nuthatch-git-exe-"));
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

describe("createGitExecutableResolver", () => {
  it("PATH 上で最初に見つかった実行可能な git の絶対パスを返す", async () => {
    const first = await makeBin("first", EXECUTABLE_MODE);
    await makeBin("second", EXECUTABLE_MODE);

    const resolved = await createGitExecutableResolver({
      PATH: `${join(sandbox, "first")}:${join(sandbox, "second")}`,
    })();

    expect(resolved).toBe(first);
  });

  it("実行権のないファイルや git という名前のディレクトリは飛ばす", async () => {
    await makeBin("not-executable", NON_EXECUTABLE_MODE);
    await mkdir(join(sandbox, "a-directory", "git"), { recursive: true });
    const real = await makeBin("real", EXECUTABLE_MODE);

    const resolved = await createGitExecutableResolver({
      PATH: [
        join(sandbox, "not-executable"),
        join(sandbox, "a-directory"),
        join(sandbox, "real"),
      ].join(":"),
    })();

    expect(resolved).toBe(real);
  });

  it("HOP_GIT が指定されていれば PATH を無視してそれを使う", async () => {
    const override = await makeBin("override", EXECUTABLE_MODE);
    await makeBin("on-path", EXECUTABLE_MODE);

    const resolved = await createGitExecutableResolver({
      HOP_GIT: override,
      PATH: join(sandbox, "on-path"),
    })();

    expect(resolved).toBe(override);
  });

  it("どこにも無ければ HOP_GIT を案内する識別可能なエラーを投げる", async () => {
    const missing = join(sandbox, "nowhere", "git");

    let thrown: unknown;
    try {
      await createGitExecutableResolver({ HOP_GIT: missing })();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as { code?: unknown }).code).toBe(GIT_NOT_FOUND_ERROR_CODE);
    expect((thrown as Error).message).toContain(missing);
    expect((thrown as Error).message).toContain("HOP_GIT");
  });

  it("解決結果をキャッシュし、git 呼び出しごとに探索し直さない", async () => {
    const resolver = createGitExecutableResolver({ PATH: join(sandbox, "cached") });
    const path = await makeBin("cached", EXECUTABLE_MODE);

    expect(await resolver()).toBe(path);
    await rm(path);

    expect(await resolver()).toBe(path);
  });
});

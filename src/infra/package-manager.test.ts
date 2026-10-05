import { execFile as execFileCb } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resolveExecutable, runCommand } from "./package-manager.ts";

const execFile = promisify(execFileCb);

const EXECUTABLE_MODE = 0o755;
const NON_EXECUTABLE_MODE = 0o644;
const PACKAGE_MANAGER_MODULE = new URL("package-manager.ts", import.meta.url).pathname;

let sandbox: string;

const makeProgram = async (dir: string, name: string, mode: number, body = ""): Promise<string> => {
  const binDir = join(sandbox, dir);
  await mkdir(binDir, { recursive: true });
  const path = join(binDir, name);
  await writeFile(path, `#!/bin/sh\n${body}\nexit 0\n`);
  await chmod(path, mode);
  return path;
};

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "nuthatch-package-manager-"));
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

describe("resolveExecutable", () => {
  it("PATH 上で最初に見つかった実行可能ファイルの絶対パスを返す", async () => {
    const first = await makeProgram("first", "mise", EXECUTABLE_MODE);
    await makeProgram("second", "mise", EXECUTABLE_MODE);

    const resolved = await resolveExecutable(
      "mise",
      `${join(sandbox, "first")}:${join(sandbox, "second")}`,
    );

    expect(resolved).toBe(first);
  });

  it("実行権のないファイルや同名のディレクトリは飛ばす", async () => {
    await makeProgram("not-executable", "npm", NON_EXECUTABLE_MODE);
    await mkdir(join(sandbox, "a-directory", "npm"), { recursive: true });
    const real = await makeProgram("real", "npm", EXECUTABLE_MODE);

    const resolved = await resolveExecutable(
      "npm",
      [join(sandbox, "not-executable"), join(sandbox, "a-directory"), join(sandbox, "real")].join(
        ":",
      ),
    );

    expect(resolved).toBe(real);
  });

  it("どこにも無い・PATH が未設定の場合、null を返す", async () => {
    expect(await resolveExecutable("bun", join(sandbox, "empty"))).toBeNull();
    expect(await resolveExecutable("bun")).toBeNull();
  });

  it("優先ディレクトリに実行可能ファイルがある場合、PATH 上に同名があってもそちらを返す", async () => {
    const preferred = await makeProgram("prefix/bin", "npm", EXECUTABLE_MODE);
    await makeProgram("path", "npm", EXECUTABLE_MODE);

    const resolved = await resolveExecutable(
      "npm",
      join(sandbox, "path"),
      join(sandbox, "prefix/bin"),
    );

    expect(resolved).toBe(preferred);
  });

  it("優先ディレクトリに無い・実行権が無い場合は、PATH から探す", async () => {
    await makeProgram("prefix/bin", "npm", NON_EXECUTABLE_MODE);
    const onPath = await makeProgram("path", "npm", EXECUTABLE_MODE);

    expect(await resolveExecutable("npm", join(sandbox, "path"), join(sandbox, "prefix/bin"))).toBe(
      onPath,
    );
    expect(await resolveExecutable("npm", join(sandbox, "path"), join(sandbox, "nowhere"))).toBe(
      onPath,
    );
  });

  it("優先ディレクトリだけにある場合、PATH が空でも見つかる", async () => {
    const preferred = await makeProgram("prefix/bin", "npm", EXECUTABLE_MODE);

    expect(await resolveExecutable("npm", "", join(sandbox, "prefix/bin"))).toBe(preferred);
  });
});

describe("runCommand", () => {
  it("終了コードをそのまま返す", async () => {
    expect(await runCommand(["/bin/sh", "-c", "exit 0"])).toBe(0);
    expect(await runCommand(["/bin/sh", "-c", "exit 3"])).toBe(3);
  });

  it("シグナルで終了した場合、プログラム名とシグナル名を含むエラーで reject する (終了コード 1 扱いにしない)", async () => {
    await expect(runCommand(["/bin/sh", "-c", "kill -TERM $$"])).rejects.toThrow(
      "sh was killed by signal SIGTERM",
    );
    await expect(runCommand(["/bin/sh", "-c", "kill -KILL $$"])).rejects.toThrow("SIGKILL");
  });

  it("起動できないプログラムの場合、reject する", async () => {
    await expect(runCommand([join(sandbox, "nowhere", "mise")])).rejects.toThrow();
  });

  it("子の作業ディレクトリは、hop を起動した場所ではなくホームディレクトリになる (リポジトリの mise.toml などに左右されない)", async () => {
    // The child's stdout goes to hop's stderr, so it reports where it ran through a file.
    const reported = join(sandbox, "child-cwd.txt");
    const launchedFrom = process.cwd();
    process.chdir(sandbox);
    try {
      expect(await runCommand(["/bin/sh", "-c", 'pwd -P > "$0"', reported])).toBe(0);
    } finally {
      process.chdir(launchedFrom);
    }

    const childCwd = await readFile(reported, "utf8");
    expect(childCwd.trim()).toBe(await realpath(homedir()));
  });

  it("子の stdout も stderr も hop の stderr に流れ、hop の stdout は汚れない", async () => {
    // A real child process, because the contract is about hop's own fd 1 and
    // 2: stdout is reserved for the JSON envelope the shell wrapper captures.
    const program = await makeProgram(
      "bin",
      "fake-mise",
      EXECUTABLE_MODE,
      'echo "child-out:$1"\necho "child-err:$2" >&2',
    );
    const helper = join(sandbox, "run.ts");
    await writeFile(
      helper,
      [
        `import { runCommand } from ${JSON.stringify(PACKAGE_MANAGER_MODULE)};`,
        "const code = await runCommand([process.argv[2] as string, 'a b; echo pwned', 'c']);",
        String.raw`process.stdout.write('parent-exit=' + code + '\n');`,
      ].join("\n"),
    );

    const { stdout, stderr } = await execFile("bun", ["run", helper, program]);

    expect(stdout).toBe("parent-exit=0\n");
    expect(stderr).toContain("child-out:a b; echo pwned");
    expect(stderr).toContain("child-err:c");
  });
});

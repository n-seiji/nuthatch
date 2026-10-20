import { execFile as execFileCb } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

const execFile = promisify(execFileCb);
const INSTALL_SCRIPT = new URL("install.sh", import.meta.url).pathname;
const BINARY_CONTENT = "hop test binary\n";
const BINARY_SHA256 = "883505c7f3d9694db7d8958ad128c2fdf70d8f57be47e8d918fac547a21d46fc";

let tempDir: string;

const writeFakeCurl = async (binDir: string): Promise<void> => {
  const fakeCurl = join(binDir, "curl");
  await Bun.write(
    fakeCurl,
    `#!/bin/sh
set -eu
url=""
output=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) output=$2; shift 2 ;;
    http*) url=$1; shift ;;
    *) shift ;;
  esac
done
printf '%s\\n' "$url" >> "$FAKE_CURL_LOG"
case "$url" in
  *.sha256) printf '%s  hop\\n' "$FAKE_CHECKSUM" > "$output" ;;
  *) printf '%s' "$FAKE_CONTENT" > "$output" ;;
esac
`,
  );
  await chmod(fakeCurl, 0o755);
};

const writeFakeGh = async (binDir: string): Promise<void> => {
  const fakeGh = join(binDir, "gh");
  await Bun.write(
    fakeGh,
    `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_GH_LOG"
exit "$FAKE_GH_STATUS"
`,
  );
  await chmod(fakeGh, 0o755);
};

const runInstaller = async (options: {
  readonly binDir: string;
  readonly installDir: string;
  readonly logPath: string;
  readonly checksum: string;
  readonly ghStatus?: number;
  readonly skipAttestation?: boolean;
  readonly pathOverride?: string;
}): Promise<{ stdout: string; stderr: string }> => {
  const result = await execFile("/bin/sh", [INSTALL_SCRIPT], {
    cwd: tempDir,
    env: {
      ...process.env,
      PATH: options.pathOverride ?? `${options.binDir}:${process.env.PATH ?? ""}`,
      HOP_INSTALL_DIR: options.installDir,
      HOP_VERSION: "v9.9.9",
      FAKE_CURL_LOG: options.logPath,
      FAKE_CHECKSUM: options.checksum,
      FAKE_CONTENT: BINARY_CONTENT,
      FAKE_GH_LOG: join(options.binDir, "gh.log"),
      FAKE_GH_STATUS: String(options.ghStatus ?? 0),
      HOP_SKIP_ATTESTATION: options.skipAttestation ? "1" : "",
    },
    encoding: "utf8",
  });
  return { stdout: result.stdout, stderr: result.stderr };
};

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "nuthatch-install-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("install.sh", () => {
  it("binary と sha256 を取得して checksum 検証後に install する", async () => {
    const binDir = join(tempDir, "bin");
    const installDir = join(tempDir, "install");
    const logPath = join(tempDir, "curl.log");
    await Bun.write(logPath, "");
    await mkdir(binDir, { recursive: true });
    await mkdir(installDir, { recursive: true });
    await writeFakeCurl(binDir);
    await writeFakeGh(binDir);

    await runInstaller({ binDir, installDir, logPath, checksum: BINARY_SHA256 });

    const installedBinary = await readFile(join(installDir, "hop"), "utf8");
    expect(installedBinary).toBe(BINARY_CONTENT);
    expect(await readdir(installDir)).toEqual(["hop"]);
    const ghLog = await readFile(join(binDir, "gh.log"), "utf8");
    expect(ghLog).toContain("attestation verify");
    expect(ghLog).toContain("--repo n-seiji/nuthatch");
    expect(ghLog).toContain(
      "--signer-workflow github.com/n-seiji/nuthatch/.github/workflows/release.yml",
    );
    const curlLog = await readFile(logPath, "utf8");
    const urls = curlLog.trim().split("\n");
    expect(urls).toHaveLength(2);
    expect(urls[1]?.endsWith(".sha256")).toBe(true);
  });

  it("checksum 不一致なら既存 binary を上書きせず一時ファイルを掃除する", async () => {
    const binDir = join(tempDir, "bin");
    const installDir = join(tempDir, "install");
    const logPath = join(tempDir, "curl.log");
    const destination = join(installDir, "hop");
    await mkdir(binDir, { recursive: true });
    await mkdir(installDir, { recursive: true });
    await Bun.write(logPath, "");
    await Bun.write(destination, "old binary\n");
    await writeFakeCurl(binDir);

    await expect(
      runInstaller({ binDir, installDir, logPath, checksum: "0".repeat(64) }),
    ).rejects.toBeDefined();

    const destinationContent = await readFile(destination, "utf8");
    expect(destinationContent).toBe("old binary\n");
    const installEntries = await readdir(installDir);
    const leftovers = installEntries.filter((name) => name.startsWith("hop.tmp."));
    expect(leftovers).toEqual([]);
  });

  const setUpProvenanceCase = async (): Promise<{
    binDir: string;
    installDir: string;
    logPath: string;
  }> => {
    const binDir = join(tempDir, "bin");
    const installDir = join(tempDir, "install");
    const logPath = join(tempDir, "curl.log");
    await mkdir(binDir, { recursive: true });
    await mkdir(installDir, { recursive: true });
    await Bun.write(logPath, "");
    await writeFakeCurl(binDir);
    await writeFakeGh(binDir);
    return { binDir, installDir, logPath };
  };

  it("provenance 検証に失敗したら install せず一時ファイルを掃除する", async () => {
    const { binDir, installDir, logPath } = await setUpProvenanceCase();

    const failure = await runInstaller({
      binDir,
      installDir,
      logPath,
      checksum: BINARY_SHA256,
      ghStatus: 1,
    }).then(
      () => {
        throw new Error("installer should have failed");
      },
      (error: { stderr: string }) => error,
    );

    expect(failure.stderr).toContain("Build provenance verification failed for hop-");
    expect(failure.stderr).toContain("gh auth status");
    expect(failure.stderr).toContain("v0.2.0 and earlier have no attestations");
    expect(await Bun.file(join(binDir, "gh.log")).exists()).toBe(true);
    expect(await readdir(installDir)).toEqual([]);
  });

  it("gh が未認証 (exit 4) なら警告だけで install する", async () => {
    const { binDir, installDir, logPath } = await setUpProvenanceCase();

    const { stderr } = await runInstaller({
      binDir,
      installDir,
      logPath,
      checksum: BINARY_SHA256,
      ghStatus: 4,
    });

    expect(stderr).toContain("not authenticated");
    expect(await Bun.file(join(binDir, "gh.log")).exists()).toBe(true);
    expect(await readdir(installDir)).toEqual(["hop"]);
    expect(await readFile(join(installDir, "hop"), "utf8")).toBe(BINARY_CONTENT);
  });

  it("gh が無ければ警告だけで install する", async () => {
    const { binDir, installDir, logPath } = await setUpProvenanceCase();
    await rm(join(binDir, "gh"));
    const toolDir = join(tempDir, "tools");
    await mkdir(toolDir, { recursive: true });
    await symlink(join(binDir, "curl"), join(toolDir, "curl"));
    const tools = ["awk", "uname", "mkdir", "rm", "chmod", "mv", "cat", "sha256sum", "shasum"];
    const linked = tools.flatMap((tool) => {
      const resolved = Bun.which(tool);
      return resolved === null ? [] : [symlink(resolved, join(toolDir, tool))];
    });
    await Promise.all(linked);

    const { stderr } = await runInstaller({
      binDir,
      installDir,
      logPath,
      checksum: BINARY_SHA256,
      pathOverride: toolDir,
    });

    expect(stderr).toContain("gh not found");
    expect(await readdir(installDir)).toEqual(["hop"]);
    expect(await readFile(join(installDir, "hop"), "utf8")).toBe(BINARY_CONTENT);
  });

  it("HOP_SKIP_ATTESTATION=1 なら gh を呼ばずに install する", async () => {
    const { binDir, installDir, logPath } = await setUpProvenanceCase();

    await runInstaller({
      binDir,
      installDir,
      logPath,
      checksum: BINARY_SHA256,
      ghStatus: 1,
      skipAttestation: true,
    });

    expect(await readFile(join(installDir, "hop"), "utf8")).toBe(BINARY_CONTENT);
    expect(await Bun.file(join(binDir, "gh.log")).exists()).toBe(false);
  });
});

import { describe, expect, it } from "bun:test";
import type { InstallFacts } from "../domain/install-method.ts";
import { EXIT_GENERAL_ERROR, EXIT_SUCCESS } from "../domain/result.ts";
import {
  bunFacts,
  createFakeSelfUpdate,
  miseFacts,
  npmFacts,
  sourceCheckoutFacts,
  standaloneFacts,
} from "../testing/self-update-port.ts";
import { selfUpdate } from "./self-update.ts";

const CURRENT = "0.1.4";
const LATEST = "0.1.5";

const facts = (value: InstallFacts) => ({
  installFacts: () => Promise.resolve(value),
});

describe("selfUpdate: すでに最新の場合", () => {
  it("最新版と同じ場合、何もダウンロードせず action: none で成功する", async () => {
    const fake = createFakeSelfUpdate({
      ...facts(standaloneFacts()),
      latestGithubVersion: () => Promise.resolve(CURRENT),
    });

    const result = await selfUpdate(fake.port, fake.term, {
      currentVersion: CURRENT,
      check: false,
    });

    expect(result).toMatchObject({
      ok: true,
      exitCode: EXIT_SUCCESS,
      data: {
        current: CURRENT,
        latest: CURRENT,
        updateAvailable: false,
        method: "standalone",
        action: "none",
        command: null,
      },
    });
    expect(fake.calls).toEqual(["installFacts", "latestGithubVersion"]);
    expect(fake.logs.join("\n")).toContain("up to date");
  });

  it("現在のほうが新しい場合 (開発版)、ダウングレードせず action: none で成功する", async () => {
    const fake = createFakeSelfUpdate({
      ...facts(standaloneFacts()),
      latestGithubVersion: () => Promise.resolve("0.1.4"),
    });

    const result = await selfUpdate(fake.port, fake.term, {
      currentVersion: "0.1.5",
      check: false,
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        current: "0.1.5",
        latest: "0.1.4",
        updateAvailable: false,
        action: "none",
      },
    });
    expect(fake.calls).toEqual(["installFacts", "latestGithubVersion"]);
  });
});

describe("selfUpdate --check", () => {
  const check = { currentVersion: CURRENT, check: true };

  it("standalone で更新がある場合、報告だけして何も変更せず、command は null になる", async () => {
    const fake = createFakeSelfUpdate({
      ...facts(standaloneFacts()),
      latestGithubVersion: () => Promise.resolve(LATEST),
    });

    const result = await selfUpdate(fake.port, fake.term, check);

    expect(result).toMatchObject({
      ok: true,
      exitCode: EXIT_SUCCESS,
      data: {
        current: CURRENT,
        latest: LATEST,
        updateAvailable: true,
        method: "standalone",
        action: "none",
        command: null,
      },
    });
    expect(fake.calls).toEqual(["installFacts", "latestGithubVersion"]);
    expect(fake.logs.join("\n")).toContain(`${CURRENT} -> ${LATEST}`);
  });

  it("mise で更新がある場合、実行されるはずのコマンドを bare name の argv で報告する (PATH 解決も spawn もしない)", async () => {
    const fake = createFakeSelfUpdate({
      ...facts(miseFacts()),
      latestGithubVersion: () => Promise.resolve(LATEST),
    });

    const result = await selfUpdate(fake.port, fake.term, check);

    expect(result.data).toEqual({
      current: CURRENT,
      latest: LATEST,
      updateAvailable: true,
      method: "mise",
      action: "none",
      command: ["mise", "upgrade", "github:n-seiji/nuthatch"],
    });
    expect(fake.calls).toEqual(["installFacts", "latestGithubVersion"]);
  });

  it("npm / bun の場合、最新版は npm から取り、npm install -g / bun add -g を報告する", async () => {
    for (const [value, method, command] of [
      [npmFacts(), "npm", ["npm", "install", "-g", "@n-seiji/nuthatch@latest"]],
      [bunFacts(), "bun", ["bun", "add", "-g", "@n-seiji/nuthatch@latest"]],
    ] as const) {
      const fake = createFakeSelfUpdate({
        ...facts(value),
        latestNpmVersion: () => Promise.resolve(LATEST),
      });

      // oxlint-disable-next-line no-await-in-loop
      const result = await selfUpdate(fake.port, fake.term, check);

      expect(result.data).toMatchObject({ method, action: "none", command });
      expect(fake.calls).toEqual(["installFacts", "latestNpmVersion"]);
    }
  });

  it("mise の npm バックエンドの場合、最新版は npm から取る", async () => {
    const fake = createFakeSelfUpdate({
      ...facts(miseFacts("npm:@n-seiji/nuthatch")),
      latestNpmVersion: () => Promise.resolve(LATEST),
    });

    const result = await selfUpdate(fake.port, fake.term, check);

    expect(result.data).toMatchObject({
      method: "mise",
      command: ["mise", "upgrade", "npm:@n-seiji/nuthatch"],
    });
    expect(fake.calls).toEqual(["installFacts", "latestNpmVersion"]);
  });

  it("更新が無い場合、package manager のコマンドも報告しない (command: null)", async () => {
    const fake = createFakeSelfUpdate({
      ...facts(miseFacts()),
      latestGithubVersion: () => Promise.resolve(CURRENT),
    });

    const result = await selfUpdate(fake.port, fake.term, check);

    expect(result.data).toMatchObject({
      updateAvailable: false,
      action: "none",
      command: null,
    });
  });
});

describe("selfUpdate: 更新の実行を委譲する", () => {
  const run = { currentVersion: CURRENT, check: false };

  it("standalone の場合、ダウンロード → 検証 → 置換まで進み action: replaced になる", async () => {
    const replaced: { path: string; text: string }[] = [];
    const digest = "a".repeat(64);
    const fake = createFakeSelfUpdate({
      ...facts(standaloneFacts("/home/u/.local/bin/hop")),
      latestGithubVersion: () => Promise.resolve(LATEST),
      downloadReleaseText: () => Promise.resolve(`${digest}  out/hop-darwin-arm64\n`),
      downloadReleaseAsset: () => Promise.resolve(new TextEncoder().encode("new binary")),
      sha256Hex: () => digest,
      replaceExecutable: (path, bytes) => {
        replaced.push({ path, text: new TextDecoder().decode(bytes) });
        return Promise.resolve();
      },
    });

    const result = await selfUpdate(fake.port, fake.term, run);

    expect(result.data).toMatchObject({
      action: "replaced",
      method: "standalone",
      command: null,
    });
    expect(replaced).toEqual([{ path: "/home/u/.local/bin/hop", text: "new binary" }]);
  });

  it("mise の場合、PATH で解決した絶対パスで mise upgrade を実行し action: delegated になる", async () => {
    const ran: (readonly string[])[] = [];
    const fake = createFakeSelfUpdate({
      ...facts(miseFacts()),
      latestGithubVersion: () => Promise.resolve(LATEST),
      resolveExecutable: () => Promise.resolve("/opt/bin/mise"),
      runCommand: (argv) => {
        ran.push(argv);
        return Promise.resolve(0);
      },
    });

    const result = await selfUpdate(fake.port, fake.term, run);

    expect(result.data).toMatchObject({
      method: "mise",
      action: "delegated",
      command: ["mise", "upgrade", "github:n-seiji/nuthatch"],
    });
    expect(ran).toEqual([["/opt/bin/mise", "upgrade", "github:n-seiji/nuthatch"]]);
  });
});

describe("selfUpdate: 更新できない場合", () => {
  const run = { currentVersion: CURRENT, check: false };

  it("ソースチェックアウトの場合、ネットワークに出る前に exit 1 で拒否する", async () => {
    const fake = createFakeSelfUpdate(facts(sourceCheckoutFacts()));

    const result = await selfUpdate(fake.port, fake.term, {
      ...run,
      check: true,
    });

    expect(result).toMatchObject({ ok: false, exitCode: EXIT_GENERAL_ERROR });
    expect(result.errorMessage).toContain("source checkout");
    expect(result.data).toBeUndefined();
    expect(fake.calls).toEqual(["installFacts"]);
  });

  it("対応バイナリの無いプラットフォームの場合、npm での入れ直しを案内して exit 1 になる", async () => {
    const fake = createFakeSelfUpdate(
      facts({ ...standaloneFacts(), platform: "linux", arch: "arm64" }),
    );

    const result = await selfUpdate(fake.port, fake.term, run);

    expect(result).toMatchObject({ ok: false, exitCode: EXIT_GENERAL_ERROR });
    expect(result.errorMessage).toMatch(/linux-arm64.*npm/u);
    expect(fake.calls).toEqual(["installFacts"]);
  });

  it("最新版の取得に失敗した場合、原因を含めて exit 1 になり、何も変更しない", async () => {
    const fake = createFakeSelfUpdate({
      ...facts(standaloneFacts()),
      latestGithubVersion: () => Promise.reject(new Error("GET https://x failed: HTTP 403")),
    });

    const result = await selfUpdate(fake.port, fake.term, run);

    expect(result).toMatchObject({ ok: false, exitCode: EXIT_GENERAL_ERROR });
    expect(result.errorMessage).toContain("HTTP 403");
    expect(fake.calls).toEqual(["installFacts", "latestGithubVersion"]);
  });

  it("バージョンを比較できない場合、推測せず exit 1 になる", async () => {
    for (const [currentVersion, latest] of [
      [CURRENT, "latest"],
      ["dev", LATEST],
    ] as const) {
      const fake = createFakeSelfUpdate({
        ...facts(standaloneFacts()),
        latestGithubVersion: () => Promise.resolve(latest),
      });

      // oxlint-disable-next-line no-await-in-loop
      const result = await selfUpdate(fake.port, fake.term, {
        currentVersion,
        check: false,
      });

      expect(result).toMatchObject({ ok: false, exitCode: EXIT_GENERAL_ERROR });
      expect(result.errorMessage).toContain("x.y.z");
      expect(fake.calls).toEqual(["installFacts", "latestGithubVersion"]);
    }
  });
});

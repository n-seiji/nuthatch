import { describe, expect, it } from "bun:test";
import type { InstallFacts } from "../domain/install-method.ts";
import { EXIT_GENERAL_ERROR, EXIT_SUCCESS } from "../domain/result.ts";
import {
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

  it("standalone で更新がある場合、置換先を報告するだけで何も変更せず、command は null になる", async () => {
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
    expect(fake.logs.join("\n")).toContain("/home/u/.local/bin/hop");
  });

  it("mise で更新がある場合、案内の 1 行と実行すべきコマンドを報告し、何も実行しない", async () => {
    const fake = createFakeSelfUpdate({
      ...facts(miseFacts()),
      latestGithubVersion: () => Promise.resolve(LATEST),
    });

    const result = await selfUpdate(fake.port, fake.term, check);

    expect(result).toMatchObject({ ok: true, exitCode: EXIT_SUCCESS });
    expect(result.data).toEqual({
      current: CURRENT,
      latest: LATEST,
      updateAvailable: true,
      method: "mise",
      action: "none",
      command: ["mise", "upgrade"],
    });
    expect(fake.calls).toEqual(["installFacts", "latestGithubVersion"]);
    expect(fake.logs.join("\n")).toContain("Update with mise: mise upgrade");
  });

  it("npm / bun などのパッケージマネージャ経由の場合、最新版は GitHub から取り、npm i -g を案内する", async () => {
    const fake = createFakeSelfUpdate({
      ...facts(npmFacts()),
      latestGithubVersion: () => Promise.resolve(LATEST),
    });

    const result = await selfUpdate(fake.port, fake.term, check);

    expect(result.data).toMatchObject({
      method: "package-manager",
      action: "none",
      command: ["npm", "i", "-g", "@n-seiji/nuthatch@latest"],
    });
    expect(fake.calls).toEqual(["installFacts", "latestGithubVersion"]);
    expect(fake.logs.join("\n")).toContain("Update with your package manager");
  });

  it("ソースチェックアウトの場合、method: other で報告し、コマンドは出さない", async () => {
    const fake = createFakeSelfUpdate({
      ...facts(sourceCheckoutFacts()),
      latestGithubVersion: () => Promise.resolve(LATEST),
    });

    const result = await selfUpdate(fake.port, fake.term, check);

    expect(result.data).toMatchObject({
      method: "other",
      action: "none",
      command: null,
    });
    expect(fake.logs.join("\n")).toContain("Update hop with the tool you installed it with.");
  });

  it("更新が無い場合、コマンドも報告しない (command: null)", async () => {
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

describe("selfUpdate: 更新を実行する", () => {
  it("standalone の場合、ダウンロード → 検証 → 置換まで進み action: replaced になる", async () => {
    const replaced: { path: string; text: string }[] = [];
    const digest = "a".repeat(64);
    const fake = createFakeSelfUpdate({
      ...facts(standaloneFacts("/home/u/.local/bin/hop")),
      latestGithubVersion: () => Promise.resolve(LATEST),
      assertWritableDir: () => Promise.resolve(),
      downloadReleaseText: () => Promise.resolve(`${digest}  out/hop-darwin-arm64\n`),
      downloadReleaseAsset: () => Promise.resolve(new TextEncoder().encode("new binary")),
      sha256Hex: () => digest,
      replaceExecutable: (path, bytes) => {
        replaced.push({ path, text: new TextDecoder().decode(bytes) });
        return Promise.resolve();
      },
    });

    const result = await selfUpdate(fake.port, fake.term, {
      currentVersion: CURRENT,
      check: false,
    });

    expect(result.data).toMatchObject({
      action: "replaced",
      method: "standalone",
      command: null,
    });
    expect(replaced).toEqual([{ path: "/home/u/.local/bin/hop", text: "new binary" }]);
  });
});

describe("selfUpdate: hop が置き換えない install の場合", () => {
  const run = { currentVersion: CURRENT, check: false };

  it("method ごとの案内を 1 行だけメッセージにして exit 1 で拒否し、ネットワークに出ない", async () => {
    for (const [value, hint] of [
      [miseFacts(), "Update with mise: mise upgrade"],
      [npmFacts(), "Update with your package manager, e.g. npm i -g @n-seiji/nuthatch@latest"],
      [sourceCheckoutFacts(), "Update hop with the tool you installed it with."],
      [
        { ...standaloneFacts("/opt/homebrew/Cellar/hop/0.1.4/bin/hop") },
        "Update hop with the tool you installed it with.",
      ],
    ] as const) {
      const fake = createFakeSelfUpdate(facts(value));

      // oxlint-disable-next-line no-await-in-loop
      const result = await selfUpdate(fake.port, fake.term, run);

      expect(result).toMatchObject({
        ok: false,
        exitCode: EXIT_GENERAL_ERROR,
        errorMessage: hint,
      });
      expect(result.data).toBeUndefined();
      expect(fake.calls).toEqual(["installFacts"]);
    }
  });
});

describe("selfUpdate: 失敗する場合", () => {
  const run = { currentVersion: CURRENT, check: false };

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

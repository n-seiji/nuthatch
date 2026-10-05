import { describe, expect, it } from "bun:test";
import type { DelegatedMethod } from "../domain/install-method.ts";
import type { SelfUpdatePort } from "../domain/ports.ts";
import { EXIT_GENERAL_ERROR, EXIT_SUCCESS } from "../domain/result.ts";
import { createFakeSelfUpdate, miseFacts, updateDataOf } from "../testing/self-update-port.ts";
import { selfUpdate } from "./self-update.ts";
import { runDelegated } from "./self-update-delegated.ts";

/**
 * Before upgrading, mise is asked (`mise upgrade --dry-run-code <tool>`: exit 1
 * when it would upgrade something, 0 when it would not) because `mise upgrade`
 * exits 0 either way — a pinned version, `minimum_release_age`, or a tool
 * outside the active config all end in "success" without moving hop.
 */

const TOOL = "github:n-seiji/nuthatch";
const mise: DelegatedMethod = { kind: "mise", tool: TOOL, channel: "github" };
const DRY_RUN = ["/opt/bin/mise", "upgrade", "--dry-run-code", TOOL];
const UPGRADE = ["/opt/bin/mise", "upgrade", TOOL];

const WOULD_UPGRADE = 1;
const NOTHING_TO_UPGRADE = 0;
/** What clap, and so an old mise that does not know `--dry-run-code`, exits with. */
const USAGE_ERROR = 2;

/**
 * A port where mise answers the `--dry-run-code` question with `probeExit` and
 * the upgrade with `upgradeExit`; with `failure`, every command fails to run.
 */
const portFor = (probeExit: number, upgradeExit = 0, failure?: Error) => {
  const ran: (readonly string[])[] = [];
  const fake = createFakeSelfUpdate({
    resolveExecutable: (name) => Promise.resolve(`/opt/bin/${name}`),
    runCommand: (argv) => {
      ran.push(argv);
      if (failure !== undefined) {
        return Promise.reject(failure);
      }
      return Promise.resolve(argv.includes("--dry-run-code") ? probeExit : upgradeExit);
    },
  });
  return { fake, ran };
};

const base = updateDataOf({ method: "mise" });

/** A port for a mise install whose latest release is 0.1.5; the tests say how the rest behaves. */
const miseFake = (overrides: Partial<SelfUpdatePort>) =>
  createFakeSelfUpdate({
    installFacts: () => Promise.resolve(miseFacts()),
    latestGithubVersion: () => Promise.resolve("0.1.5"),
    ...overrides,
  });

describe("runDelegated: mise に先に問い合わせる", () => {
  it("mise が upgrade すると答えた (exit 1) 場合、続けて mise upgrade を実行し action: delegated を返す", async () => {
    const { fake, ran } = portFor(WOULD_UPGRADE);

    const result = await runDelegated(fake.port, fake.term, mise, base);

    expect(result).toMatchObject({ ok: true, exitCode: EXIT_SUCCESS });
    expect(result.data).toEqual({
      ...base,
      action: "delegated",
      command: ["mise", "upgrade", TOOL],
    });
    expect(result.warnings).toBeUndefined();
    expect(ran).toEqual([DRY_RUN, UPGRADE]);
    expect(fake.calls).toEqual(["resolveExecutable", "runCommand", "runCommand"]);
  });

  it("mise が upgrade するものは無いと答えた (exit 0) 場合、mise upgrade は実行せず、action: none の成功に警告を付けて返す", async () => {
    const { fake, ran } = portFor(NOTHING_TO_UPGRADE);

    const result = await runDelegated(fake.port, fake.term, mise, base);

    expect(result).toMatchObject({ ok: true, exitCode: EXIT_SUCCESS });
    expect(result.data).toEqual({ ...base, updateAvailable: true, action: "none", command: null });
    expect(ran).toEqual([DRY_RUN]);
    expect(fake.calls).toEqual(["resolveExecutable", "runCommand"]);
  });

  it("何もしなかった場合の警告は、考えられる原因 (固定されたバージョン / minimum_release_age / グローバル設定に無い) と対象のツール・バージョンを挙げる", async () => {
    const { fake } = portFor(NOTHING_TO_UPGRADE);

    const result = await runDelegated(fake.port, fake.term, mise, base);

    expect(result.warnings).toHaveLength(1);
    const [warning] = result.warnings ?? [];
    expect(warning).toContain(TOOL);
    expect(warning).toContain(base.current);
    expect(warning).toContain(base.latest);
    expect(warning).toContain("pinned");
    expect(warning).toContain("minimum_release_age");
    expect(warning).toContain("global mise config");
    expect(warning).toContain("from your home directory");
    expect(warning).toContain(`mise upgrade --dry-run ${TOOL}`);
  });

  it("exit 0 / 1 以外 (mise upgrade --dry-run-code を知らない古い mise) の場合、従来どおり mise upgrade を実行する", async () => {
    const { fake, ran } = portFor(USAGE_ERROR);

    const result = await runDelegated(fake.port, fake.term, mise, base);

    expect(result.data).toMatchObject({ action: "delegated", command: ["mise", "upgrade", TOOL] });
    expect(result.warnings).toBeUndefined();
    expect(ran).toEqual([DRY_RUN, UPGRADE]);
  });

  it("問い合わせを実行できない・シグナルで終了した場合、mise upgrade には進まず、原因を含めて exit 1 になる", async () => {
    const { fake, ran } = portFor(WOULD_UPGRADE, 0, new Error("mise was killed by signal SIGTERM"));

    const result = await runDelegated(fake.port, fake.term, mise, base);

    expect(result).toMatchObject({ ok: false, exitCode: EXIT_GENERAL_ERROR });
    expect(result.errorMessage).toBe(
      `Failed to run mise upgrade --dry-run-code ${TOOL}: mise was killed by signal SIGTERM`,
    );
    expect(result.data).toBeUndefined();
    expect(ran).toEqual([DRY_RUN]);
  });

  it("問い合わせも mise upgrade も、解決した絶対パス付きで stderr に出す", async () => {
    const { fake } = portFor(WOULD_UPGRADE);

    await runDelegated(fake.port, fake.term, mise, base);

    expect(fake.logs).toContain(`Running: ${DRY_RUN.join(" ")}`);
    expect(fake.logs).toContain(`Running: ${UPGRADE.join(" ")}`);
  });

  it("問い合わせに答えた mise upgrade が非 0 で終わった場合は、従来どおり exit 1 になる", async () => {
    const { fake } = portFor(WOULD_UPGRADE, 7);

    const result = await runDelegated(fake.port, fake.term, mise, base);

    expect(result).toMatchObject({ ok: false, exitCode: EXIT_GENERAL_ERROR });
    expect(result.errorMessage).toContain(`mise upgrade ${TOOL} exited with code 7`);
  });
});

describe("runDelegated: mise 以外には問い合わせを挟まない", () => {
  it("npm / bun の場合、実行するのは upgrade のコマンド 1 つだけ", async () => {
    for (const method of [{ kind: "npm", prefix: "/usr/local" }, { kind: "bun" }] as const) {
      const { fake, ran } = portFor(NOTHING_TO_UPGRADE);

      // oxlint-disable-next-line no-await-in-loop
      const result = await runDelegated(
        fake.port,
        fake.term,
        method,
        updateDataOf({ method: method.kind }),
      );

      expect(result.data).toMatchObject({ action: "delegated" });
      expect(ran).toHaveLength(1);
      expect(ran[0]).not.toContain("--dry-run-code");
    }
  });
});

describe("selfUpdate: mise の確認を経た結果", () => {
  it("mise が何もしないと答えた場合、更新はあるが action: none・警告つきの exit 0 で、mise upgrade は実行されない", async () => {
    const fake = miseFake({
      resolveExecutable: () => Promise.resolve("/opt/bin/mise"),
      runCommand: () => Promise.resolve(NOTHING_TO_UPGRADE),
    });

    const result = await selfUpdate(fake.port, fake.term, {
      currentVersion: "0.1.4",
      check: false,
    });

    expect(result).toMatchObject({ ok: true, exitCode: EXIT_SUCCESS });
    expect(result.data).toEqual({
      current: "0.1.4",
      latest: "0.1.5",
      updateAvailable: true,
      method: "mise",
      action: "none",
      command: null,
    });
    expect(result.warnings).toHaveLength(1);
    expect(fake.calls).toEqual([
      "installFacts",
      "latestGithubVersion",
      "resolveExecutable",
      "runCommand",
    ]);
  });

  it("--check の場合、mise を探しも問い合わせもしない (フェイクは想定外の呼び出しで失敗する)", async () => {
    const fake = miseFake({});

    const result = await selfUpdate(fake.port, fake.term, { currentVersion: "0.1.4", check: true });

    expect(result.data).toMatchObject({ action: "none", command: ["mise", "upgrade", TOOL] });
    expect(result.warnings).toBeUndefined();
    expect(fake.calls).toEqual(["installFacts", "latestGithubVersion"]);
  });
});

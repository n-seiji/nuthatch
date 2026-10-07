import { describe, expect, it } from "bun:test";
import type { DelegatedMethod } from "../domain/install-method.ts";
import type { SelfUpdatePort } from "../domain/ports.ts";
import { EXIT_GENERAL_ERROR, EXIT_SUCCESS } from "../domain/result.ts";
import { createFakeSelfUpdate, updateDataOf } from "../testing/self-update-port.ts";
import { runDelegated } from "./self-update-delegated.ts";

const mise: DelegatedMethod = {
  kind: "mise",
  tool: "github:n-seiji/nuthatch",
  channel: "github",
};

const DRY_RUN_FLAG = "--dry-run-code";
/** What `mise upgrade --dry-run-code` exits with when `mise upgrade` would change something. */
const WOULD_UPGRADE = 1;

/**
 * A port where `program` is in the preferred dir it is asked to try first, else
 * at /opt/bin/<program>, and every command exits with `exitCode` — except
 * mise's `--dry-run-code` question, which always answers "would upgrade".
 */
const portFor = (exitCode: number, overrides: Partial<SelfUpdatePort> = {}) => {
  const ran: (readonly string[])[] = [];
  const resolved: (readonly [string, string | null])[] = [];
  const fake = createFakeSelfUpdate({
    resolveExecutable: (name, preferredDir) => {
      resolved.push([name, preferredDir]);
      return Promise.resolve(`${preferredDir ?? "/opt/bin"}/${name}`);
    },
    runCommand: (argv) => {
      ran.push(argv);
      return Promise.resolve(argv.includes(DRY_RUN_FLAG) ? WOULD_UPGRADE : exitCode);
    },
    ...overrides,
  });
  return { fake, ran, resolved };
};

describe("runDelegated", () => {
  it("mise の場合、解決した絶対パスで dry-run の確認のあとに mise upgrade <tool> を実行し action: delegated を返す", async () => {
    const { fake, ran, resolved } = portFor(0);

    const result = await runDelegated(fake.port, fake.term, mise, updateDataOf({ method: "mise" }));

    expect(result).toMatchObject({ ok: true, exitCode: EXIT_SUCCESS });
    expect(result.data).toEqual(
      updateDataOf({
        method: "mise",
        action: "delegated",
        command: ["mise", "upgrade", "github:n-seiji/nuthatch"],
      }),
    );
    expect(resolved).toEqual([["mise", null]]);
    expect(ran).toEqual([
      ["/opt/bin/mise", "upgrade", "--dry-run-code", "github:n-seiji/nuthatch"],
      ["/opt/bin/mise", "upgrade", "github:n-seiji/nuthatch"],
    ]);
  });

  it("npm の場合、hop が入っている prefix の bin から npm を探し、その prefix を --prefix に渡して実行する", async () => {
    const { fake, ran, resolved } = portFor(0);

    const result = await runDelegated(
      fake.port,
      fake.term,
      { kind: "npm", prefix: "/opt/homebrew" },
      updateDataOf({ method: "npm" }),
    );

    expect(resolved).toEqual([["npm", "/opt/homebrew/bin"]]);
    expect(ran).toEqual([
      [
        "/opt/homebrew/bin/npm",
        "install",
        "-g",
        "--prefix",
        "/opt/homebrew",
        "@n-seiji/nuthatch@latest",
      ],
    ]);
    expect(result.data).toMatchObject({
      method: "npm",
      action: "delegated",
      command: ["npm", "install", "-g", "--prefix", "/opt/homebrew", "@n-seiji/nuthatch@latest"],
    });
  });

  it("bun の場合、bun add -g @n-seiji/nuthatch@latest を実行する", async () => {
    const { fake, ran } = portFor(0);

    const result = await runDelegated(
      fake.port,
      fake.term,
      { kind: "bun" },
      updateDataOf({ method: "bun" }),
    );

    expect(ran).toEqual([["/opt/bin/bun", "add", "-g", "@n-seiji/nuthatch@latest"]]);
    expect(result.data).toMatchObject({ method: "bun", action: "delegated" });
    expect(fake.calls).toEqual(["resolveExecutable", "runCommand"]);
  });

  it("コマンドが非 0 で終わった場合、コマンドと終了コードを含めて exit 1 になる", async () => {
    const { fake } = portFor(7);

    const result = await runDelegated(fake.port, fake.term, mise, updateDataOf({ method: "mise" }));

    expect(result).toMatchObject({ ok: false, exitCode: EXIT_GENERAL_ERROR });
    expect(result.errorMessage).toContain("mise upgrade github:n-seiji/nuthatch");
    expect(result.errorMessage).toContain("code 7");
    expect(result.data).toBeUndefined();
  });

  it("package manager が PATH に無い場合、実行すべきコマンドをそのまま案内して exit 1 になり、何も実行しない", async () => {
    const { fake, ran } = portFor(0, {
      resolveExecutable: () => Promise.resolve(null),
    });

    const result = await runDelegated(fake.port, fake.term, mise, updateDataOf({ method: "mise" }));

    expect(result).toMatchObject({ ok: false, exitCode: EXIT_GENERAL_ERROR });
    expect(result.errorMessage).toContain("mise");
    expect(result.errorMessage).toContain("mise upgrade github:n-seiji/nuthatch");
    expect(ran).toEqual([]);
    expect(fake.calls).toEqual(["resolveExecutable"]);
  });

  it("コマンドを起動できなかった場合、原因を含めて exit 1 になる", async () => {
    const { fake } = portFor(0, {
      runCommand: () => Promise.reject(new Error("spawn EACCES")),
    });

    const result = await runDelegated(
      fake.port,
      fake.term,
      { kind: "npm", prefix: "/usr/local" },
      updateDataOf({ method: "npm" }),
    );

    expect(result).toMatchObject({ ok: false, exitCode: EXIT_GENERAL_ERROR });
    expect(result.errorMessage).toContain("npm install -g");
    expect(result.errorMessage).toContain("spawn EACCES");
  });

  it("コマンドがシグナルで終了した場合、コマンドとシグナル名を含めて exit 1 になる (終了コードのように扱わない)", async () => {
    const { fake } = portFor(0, {
      runCommand: (argv) =>
        argv.includes(DRY_RUN_FLAG)
          ? Promise.resolve(WOULD_UPGRADE)
          : Promise.reject(new Error("mise was killed by signal SIGTERM")),
    });

    const result = await runDelegated(fake.port, fake.term, mise, updateDataOf({ method: "mise" }));

    expect(result).toMatchObject({ ok: false, exitCode: EXIT_GENERAL_ERROR });
    expect(result.errorMessage).toBe(
      "Failed to run mise upgrade github:n-seiji/nuthatch: mise was killed by signal SIGTERM",
    );
  });

  it("実行するコマンドを、解決した絶対パス付きで stderr に出す (どの npm / bun が動いたか分かる)", async () => {
    for (const [method, running] of [
      [
        { kind: "npm", prefix: "/opt/homebrew" },
        "Running: /opt/homebrew/bin/npm install -g --prefix /opt/homebrew @n-seiji/nuthatch@latest",
      ],
      [{ kind: "bun" }, "Running: /opt/bin/bun add -g @n-seiji/nuthatch@latest"],
    ] as const) {
      const { fake } = portFor(0);

      // oxlint-disable-next-line no-await-in-loop
      await runDelegated(fake.port, fake.term, method, updateDataOf({ method: method.kind }));

      expect(fake.logs).toContain(running);
    }
  });
});

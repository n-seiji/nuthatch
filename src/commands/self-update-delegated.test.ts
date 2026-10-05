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

/** A port where `program` is at /opt/bin/<program> and every command exits with `exitCode`. */
const portFor = (exitCode: number, overrides: Partial<SelfUpdatePort> = {}) => {
  const ran: (readonly string[])[] = [];
  const resolved: string[] = [];
  const fake = createFakeSelfUpdate({
    resolveExecutable: (name) => {
      resolved.push(name);
      return Promise.resolve(`/opt/bin/${name}`);
    },
    runCommand: (argv) => {
      ran.push(argv);
      return Promise.resolve(exitCode);
    },
    ...overrides,
  });
  return { fake, ran, resolved };
};

describe("runDelegated", () => {
  it("mise の場合、解決した絶対パスで mise upgrade <tool> を実行し action: delegated を返す", async () => {
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
    expect(resolved).toEqual(["mise"]);
    expect(ran).toEqual([["/opt/bin/mise", "upgrade", "github:n-seiji/nuthatch"]]);
  });

  it("npm の場合、npm install -g @n-seiji/nuthatch@latest を実行する", async () => {
    const { fake, ran } = portFor(0);

    const result = await runDelegated(
      fake.port,
      fake.term,
      { kind: "npm" },
      updateDataOf({ method: "npm" }),
    );

    expect(ran).toEqual([["/opt/bin/npm", "install", "-g", "@n-seiji/nuthatch@latest"]]);
    expect(result.data).toMatchObject({
      method: "npm",
      action: "delegated",
      command: ["npm", "install", "-g", "@n-seiji/nuthatch@latest"],
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
      { kind: "npm" },
      updateDataOf({ method: "npm" }),
    );

    expect(result).toMatchObject({ ok: false, exitCode: EXIT_GENERAL_ERROR });
    expect(result.errorMessage).toContain("npm install -g");
    expect(result.errorMessage).toContain("spawn EACCES");
  });

  it("実行するコマンドを stderr に出す", async () => {
    const { fake } = portFor(0);

    await runDelegated(fake.port, fake.term, mise, updateDataOf({ method: "mise" }));

    expect(fake.logs.join("\n")).toContain("Running: mise upgrade github:n-seiji/nuthatch");
  });
});

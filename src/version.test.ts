import { readFile } from "node:fs/promises";
import { describe, expect, it } from "bun:test";
import { requireVersion } from "./domain/self-update.ts";
import { VERSION } from "./version.ts";

describe("VERSION", () => {
  it("package.json の version と一致する (リリースのタグ検証と同じ正本を使う)", async () => {
    const text = await readFile(new URL("../package.json", import.meta.url), "utf8");
    const manifest = JSON.parse(text) as { version: string };

    expect(VERSION).toBe(manifest.version);
  });

  it("self-update が比較できる x.y.z 形式である", () => {
    expect(requireVersion(VERSION)).toBe(VERSION);
  });
});

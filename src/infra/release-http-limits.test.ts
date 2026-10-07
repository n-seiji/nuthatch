import { describe, expect, it } from "bun:test";
import {
  GITHUB_LATEST_RELEASE_URL,
  NPM_LATEST_URL,
  releaseAssetUrl,
} from "../domain/self-update.ts";
import { createReleaseHttp } from "./release-http.ts";

/**
 * How much of a response hop is willing to buffer. No real network: `fetch` is
 * replaced by a function that answers with the one canned Response, and the
 * limits are the numbers the design document promises (1 MiB for metadata,
 * 4 KiB for a `.sha256`, 256 MiB for a binary).
 */

const KIB = 1024;
const MIB = 1024 * KIB;
const METADATA_LIMIT = MIB;
const CHECKSUM_LIMIT = 4 * KIB;
const BINARY_LIMIT = 256 * MIB;
const SAFETY_VALVE_CHUNKS = 8;

const CHECKSUM_ASSET = "hop-linux-x64.sha256";
const BINARY_ASSET = "hop-linux-x64";

const httpReturning = (response: Response) =>
  createReleaseHttp("hop/0.1.5", () => Promise.resolve(response));

const tooLarge = (url: string, limit: number): string =>
  `GET ${url} failed while reading the response: the response is larger than ${limit} bytes`;

/** A response whose headers promise `length` bytes, whatever the body really is. */
const claiming = (length: number, body = "x"): Response =>
  new Response(body, { headers: { "content-length": String(length) } });

/**
 * A body that would never end, `chunkBytes` at a time, recording how far it
 * was read. It does stop `SAFETY_VALVE_CHUNKS` chunks past `limit`, but only
 * as a valve: a reader that ignores the limit would buffer without bound.
 */
const endless = (chunkBytes: number, limit: number, headers: Record<string, string> = {}) => {
  const chunk = new Uint8Array(chunkBytes);
  const lastPull = limit / chunkBytes + SAFETY_VALVE_CHUNKS;
  const state = { pulls: 0, lastPull, cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      state.pulls += 1;
      controller.enqueue(chunk);
      if (state.pulls >= lastPull) {
        controller.close();
      }
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { response: new Response(body, { headers }), state };
};

describe("JSON メタデータ (最新版の問い合わせ)", () => {
  it("1 MiB を超えると Content-Length に書かれている場合、URL を含むエラーにする", async () => {
    const http = httpReturning(claiming(METADATA_LIMIT + 1, '{"tag_name":"v0.1.4"}'));

    await expect(http.latestGithubVersion()).rejects.toThrow(
      tooLarge(GITHUB_LATEST_RELEASE_URL, METADATA_LIMIT),
    );
  });

  it("Content-Length が無くても、1 MiB を超えて流れ続ける場合、読み切らずに打ち切る", async () => {
    const { response, state } = endless(64 * KIB, METADATA_LIMIT);

    await expect(httpReturning(response).latestNpmVersion()).rejects.toThrow(
      tooLarge(NPM_LATEST_URL, METADATA_LIMIT),
    );

    expect(state.cancelled).toBe(true);
    expect(state.pulls).toBeLessThan(state.lastPull);
  });
});

describe(".sha256 などのテキスト", () => {
  const url = releaseAssetUrl("0.1.5", CHECKSUM_ASSET);

  it("4 KiB を超える場合、Content-Length の有無にかかわらず URL を含むエラーにする", async () => {
    const oversize = [claiming(CHECKSUM_LIMIT + 1), new Response("x".repeat(CHECKSUM_LIMIT + 1))];
    for (const response of oversize) {
      // oxlint-disable-next-line no-await-in-loop
      await expect(
        httpReturning(response).downloadReleaseText("0.1.5", CHECKSUM_ASSET),
      ).rejects.toThrow(tooLarge(url, CHECKSUM_LIMIT));
    }
  });

  it("ちょうど 4 KiB の場合は返す", async () => {
    const http = httpReturning(new Response("x".repeat(CHECKSUM_LIMIT)));

    expect(await http.downloadReleaseText("0.1.5", CHECKSUM_ASSET)).toHaveLength(CHECKSUM_LIMIT);
  });

  it("Content-Length が実際より小さく書かれていても、実際に流れたバイト数を数えて上限を守る", async () => {
    const { response, state } = endless(KIB, CHECKSUM_LIMIT, { "content-length": "10" });

    await expect(
      httpReturning(response).downloadReleaseText("0.1.5", CHECKSUM_ASSET),
    ).rejects.toThrow(tooLarge(url, CHECKSUM_LIMIT));

    expect(state.cancelled).toBe(true);
  });

  it("上限以内の本文は、Content-Length があってもなくても、そのまま返す", async () => {
    const withLength = httpReturning(claiming(3, "abc"));
    const withoutLength = httpReturning(new Response("abc"));

    expect(await withLength.downloadReleaseText("0.1.5", CHECKSUM_ASSET)).toBe("abc");
    expect(await withoutLength.downloadReleaseText("0.1.5", CHECKSUM_ASSET)).toBe("abc");
  });
});

describe("release のバイナリ", () => {
  const url = releaseAssetUrl("0.1.5", BINARY_ASSET);

  it("256 MiB を超えると Content-Length に書かれている場合、本文を読まずに URL を含むエラーにする", async () => {
    const http = httpReturning(claiming(BINARY_LIMIT + 1));

    await expect(http.downloadReleaseAsset("0.1.5", BINARY_ASSET)).rejects.toThrow(
      tooLarge(url, BINARY_LIMIT),
    );
  });

  it("Content-Length が無くても、256 MiB を超えて流れ続ける場合、読み切らずに打ち切る", async () => {
    const { response, state } = endless(MIB, BINARY_LIMIT);

    await expect(
      httpReturning(response).downloadReleaseAsset("0.1.5", BINARY_ASSET),
    ).rejects.toThrow(tooLarge(url, BINARY_LIMIT));

    expect(state.cancelled).toBe(true);
    expect(state.pulls).toBeLessThan(state.lastPull);
  });

  it("本文が空 (body が null) の場合は、空として扱う", async () => {
    const http = httpReturning(new Response(null));

    expect([...(await http.downloadReleaseAsset("0.1.5", BINARY_ASSET))]).toEqual([]);
    expect(await http.downloadReleaseText("0.1.5", CHECKSUM_ASSET)).toBe("");
  });
});

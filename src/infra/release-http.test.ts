import { describe, expect, it } from "bun:test";
import {
  GITHUB_LATEST_RELEASE_URL,
  NPM_LATEST_URL,
  releaseAssetUrl,
} from "../domain/self-update.ts";
import { createReleaseHttp } from "./release-http.ts";

/**
 * No real network: `fetch` is replaced by a function that records the request
 * and answers with a canned Response, so what is pinned here is hop's own
 * handling of the answer — which URL it asks for, and what it makes of a bad
 * status, a bad body, or a redirect away from HTTPS.
 */

interface RecordedRequest {
  readonly url: string;
  readonly init: RequestInit;
}

const jsonResponse = (body: unknown, status = 200): Response => Response.json(body, { status });

/** The message of the error `promise` rejects with, for tests that pin it exactly. */
const rejectionMessage = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "did not reject";
};

const withUrl = (response: Response, url: string): Response => {
  Object.defineProperty(response, "url", { value: url });
  return response;
};

/** A response whose body has not been read, recording whether it was cancelled. */
const unreadBody = (init: ResponseInit) => {
  const state = { cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      state.cancelled = true;
    },
  });
  return { response: new Response(body, init), state };
};

const httpWith = (respond: (url: string) => Response | Promise<Response>) => {
  const requests: RecordedRequest[] = [];
  const http = createReleaseHttp("hop/0.1.5", async (url, init) => {
    requests.push({ url, init });
    return await respond(url);
  });
  return { http, requests };
};

describe("latestGithubVersion", () => {
  it("リリース API の tag_name から v を外したバージョンを返す", async () => {
    const { http } = httpWith(() => jsonResponse({ tag_name: "v0.1.4", name: "ignored" }));

    expect(await http.latestGithubVersion()).toBe("0.1.4");
  });

  it("固定の URL へ GitHub API 用のヘッダーとタイムアウト付きで GET する", async () => {
    const { http, requests } = httpWith(() => jsonResponse({ tag_name: "v0.1.4" }));

    await http.latestGithubVersion();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(GITHUB_LATEST_RELEASE_URL);
    expect(requests[0]?.init.headers).toMatchObject({
      Accept: "application/vnd.github+json",
      "User-Agent": "hop/0.1.5",
    });
    expect(requests[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("tag_name が無い・vX.Y.Z でない場合、エラーにする", async () => {
    await expect(httpWith(() => jsonResponse({})).http.latestGithubVersion()).rejects.toThrow(
      /unexpected response/u,
    );
    await expect(
      httpWith(() => jsonResponse({ tag_name: "v1.2.3-rc.1" })).http.latestGithubVersion(),
    ).rejects.toThrow(/release tag/u);
  });
});

describe("latestNpmVersion", () => {
  it("レジストリの latest の version を返し、固定の URL へ GET する", async () => {
    const { http, requests } = httpWith(() => jsonResponse({ version: "0.1.3" }));

    expect(await http.latestNpmVersion()).toBe("0.1.3");
    expect(requests[0]?.url).toBe(NPM_LATEST_URL);
    expect(requests[0]?.init.headers).toMatchObject({
      "User-Agent": "hop/0.1.5",
    });
  });

  it("version が x.y.z でない場合、エラーにする", async () => {
    await expect(
      httpWith(() => jsonResponse({ version: "0.2.0-beta.1" })).http.latestNpmVersion(),
    ).rejects.toThrow(/x\.y\.z/u);
  });
});

describe("リクエストの失敗", () => {
  it("2xx 以外の場合、URL とステータスを含むエラーにする", async () => {
    const { http } = httpWith(() => new Response("rate limited", { status: 403 }));

    await expect(http.latestGithubVersion()).rejects.toThrow(
      `GET ${GITHUB_LATEST_RELEASE_URL} failed: HTTP 403`,
    );
  });

  it("GitHub API が 403 / 429 で残りの呼び出し回数が 0 の場合、認証なしのレート制限に達したことと、時間を置いて再試行することを伝える", async () => {
    for (const status of [403, 429]) {
      const { http } = httpWith(
        () => new Response("rate limited", { status, headers: { "x-ratelimit-remaining": "0" } }),
      );

      // oxlint-disable-next-line no-await-in-loop
      await expect(http.latestGithubVersion()).rejects.toThrow(
        `GET ${GITHUB_LATEST_RELEASE_URL} failed: HTTP ${status} (the unauthenticated GitHub API rate limit was hit; try again later)`,
      );
    }
  });

  it("403 でもレート制限のヘッダーが無い・残りが 0 でない場合は、レート制限とは言わない", async () => {
    for (const headers of [{}, { "x-ratelimit-remaining": "12" }]) {
      const { http } = httpWith(() => new Response("forbidden", { status: 403, headers }));

      // oxlint-disable-next-line no-await-in-loop
      const message = await rejectionMessage(http.latestGithubVersion());

      expect(message).toBe(`GET ${GITHUB_LATEST_RELEASE_URL} failed: HTTP 403`);
    }
  });

  it("GitHub API 以外 (npm レジストリ) の 429 は、同じヘッダーがあってもレート制限の案内を付けない", async () => {
    const { http } = httpWith(
      () => new Response("slow down", { status: 429, headers: { "x-ratelimit-remaining": "0" } }),
    );

    const message = await rejectionMessage(http.latestNpmVersion());

    expect(message).toBe(`GET ${NPM_LATEST_URL} failed: HTTP 429`);
  });

  it("接続に失敗した場合、URL と原因を含むエラーにする", async () => {
    const { http } = httpWith(() => Promise.reject(new TypeError("fetch failed")));

    await expect(http.latestNpmVersion()).rejects.toThrow(
      `GET ${NPM_LATEST_URL} failed: fetch failed`,
    );
  });

  it("本文が JSON でない場合、URL を含むエラーにする", async () => {
    const { http } = httpWith(() => new Response("<html>oops</html>"));

    await expect(http.latestGithubVersion()).rejects.toThrow(GITHUB_LATEST_RELEASE_URL);
  });

  it("HTTPS でない URL へのリダイレクトの場合、拒否する", async () => {
    const { http } = httpWith(() =>
      withUrl(jsonResponse({ tag_name: "v0.1.4" }), "http://example.com/downgraded"),
    );

    await expect(http.latestGithubVersion()).rejects.toThrow(/not HTTPS/u);
  });
});

describe("拒否した応答の本文", () => {
  it("2xx 以外の場合、本文を読まずに破棄してからエラーにする (接続を掴んだままにしない)", async () => {
    const { response, state } = unreadBody({ status: 404 });
    const { http } = httpWith(() => response);

    await expect(http.downloadReleaseAsset("9.9.9", "hop-linux-x64")).rejects.toThrow("HTTP 404");

    expect(state.cancelled).toBe(true);
  });

  it("HTTPS でない URL へのリダイレクトの場合も、本文を破棄してからエラーにする", async () => {
    const { response, state } = unreadBody({ status: 200 });
    const { http } = httpWith(() => withUrl(response, "http://example.com/downgraded"));

    await expect(http.downloadReleaseAsset("0.1.5", "hop-linux-x64")).rejects.toThrow(/not HTTPS/u);

    expect(state.cancelled).toBe(true);
  });

  it("本文の破棄に失敗しても、拒否した本当の理由 (ステータス) を隠さない", async () => {
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        throw new Error("stream already errored");
      },
    });
    const { http } = httpWith(() => new Response(body, { status: 403 }));

    await expect(http.latestGithubVersion()).rejects.toThrow(
      `GET ${GITHUB_LATEST_RELEASE_URL} failed: HTTP 403`,
    );
  });
});

describe("release asset のダウンロード", () => {
  it("解決済みのタグ (v<version>) の asset をバイト列で返す", async () => {
    const { http, requests } = httpWith(() => new Response(new Uint8Array([1, 2, 3, 255])));

    const bytes = await http.downloadReleaseAsset("0.1.5", "hop-linux-x64");

    expect([...bytes]).toEqual([1, 2, 3, 255]);
    expect(requests[0]?.url).toBe(releaseAssetUrl("0.1.5", "hop-linux-x64"));
    expect(requests[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it(".sha256 などの小さな asset をテキストで返す", async () => {
    const { http, requests } = httpWith(() => new Response("abc  out/hop-linux-x64\n"));

    expect(await http.downloadReleaseText("0.1.5", "hop-linux-x64.sha256")).toBe(
      "abc  out/hop-linux-x64\n",
    );
    expect(requests[0]?.url).toBe(releaseAssetUrl("0.1.5", "hop-linux-x64.sha256"));
  });

  it("404 の場合、URL とステータスを含むエラーにする", async () => {
    const { http } = httpWith(() => new Response("", { status: 404 }));

    await expect(http.downloadReleaseAsset("9.9.9", "hop-linux-x64")).rejects.toThrow(
      `GET ${releaseAssetUrl("9.9.9", "hop-linux-x64")} failed: HTTP 404`,
    );
  });
});

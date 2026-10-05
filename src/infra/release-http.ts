import { type GenericSchema, type InferOutput, object, safeParse, string } from "valibot";
import { messageOf } from "../domain/fatal-error.ts";
import {
  GITHUB_LATEST_RELEASE_URL,
  NPM_LATEST_URL,
  releaseAssetUrl,
  requireVersion,
  versionFromTag,
} from "../domain/self-update.ts";
import { readCapped } from "./capped-body.ts";

/**
 * The only network access hop does: HTTPS GETs against the fixed GitHub / npm
 * addresses in domain/self-update.ts, each with a timeout. Every failure is
 * an Error that names the URL, so `hop --update` can say what it could not
 * reach.
 */

/** `fetch`, narrowed to what is used, so tests can substitute a canned one. */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export interface ReleaseHttp {
  /** Version of the latest GitHub release (its tag without the leading `v`). */
  latestGithubVersion: () => Promise<string>;
  /** Version npm's `latest` dist-tag points at. */
  latestNpmVersion: () => Promise<string>;
  /** Bytes of release asset `assetName` of tag `v<version>`. */
  downloadReleaseAsset: (version: string, assetName: string) => Promise<Uint8Array>;
  /** Text of a small release asset of tag `v<version>`, e.g. its `.sha256` file. */
  downloadReleaseText: (version: string, assetName: string) => Promise<string>;
}

const METADATA_TIMEOUT_MS = 15_000;
/**
 * A release binary is tens of MB, and the timeout covers reading the body
 * too: the metadata timeout would abort a slow but healthy download.
 */
const ASSET_TIMEOUT_MS = 300_000;

/** How much of a response is accepted before it is refused as too large (1 MiB). */
const METADATA_MAX_BYTES = 1_048_576;
/** A `.sha256` file is one line (4 KiB). */
const CHECKSUM_MAX_BYTES = 4096;
/** A release binary is tens of MB; this leaves room to grow (256 MiB). */
const BINARY_MAX_BYTES = 268_435_456;

const GITHUB_API_ORIGIN = "https://api.github.com/";
const HTTP_FORBIDDEN = 403;
const HTTP_TOO_MANY_REQUESTS = 429;

const GithubLatestSchema = object({ tag_name: string() });
const NpmLatestSchema = object({ version: string() });

const DECODER = new TextDecoder();

interface GetOptions {
  readonly headers: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  /** The most bytes the body may have. */
  readonly maxBytes: number;
}

const send = async (
  fetcher: Fetcher,
  url: string,
  { headers, timeoutMs }: GetOptions,
): Promise<Response> => {
  try {
    return await fetcher(url, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(`GET ${url} failed: ${messageOf(error)}`, { cause: error });
  }
};

/**
 * What GitHub's API says when the anonymous quota is used up: a bare 403 (or
 * 429) with `x-ratelimit-remaining: 0`, which on its own reads like a
 * permission problem.
 */
const rateLimitHint = (url: string, response: Response): string => {
  const refused = response.status === HTTP_FORBIDDEN || response.status === HTTP_TOO_MANY_REQUESTS;
  const exhausted = refused && response.headers.get("x-ratelimit-remaining") === "0";
  return exhausted && url.startsWith(GITHUB_API_ORIGIN)
    ? " (the unauthenticated GitHub API rate limit was hit; try again later)"
    : "";
};

const get = async (fetcher: Fetcher, url: string, options: GetOptions): Promise<Response> => {
  const response = await send(fetcher, url, options);
  if (!response.ok) {
    throw new Error(`GET ${url} failed: HTTP ${response.status}${rateLimitHint(url, response)}`);
  }
  // Release downloads redirect to a CDN; `fetch` would follow one to plain HTTP.
  if (response.url.startsWith("http://")) {
    throw new Error(`GET ${url} failed: redirected to ${response.url}, which is not HTTPS`);
  }
  return response;
};

const readBody = async <T>(url: string, read: () => T | Promise<T>): Promise<T> => {
  try {
    return await read();
  } catch (error) {
    throw new Error(`GET ${url} failed while reading the response: ${messageOf(error)}`, {
      cause: error,
    });
  }
};

/** The whole body, within `options.maxBytes`. */
const getBytes = async (
  fetcher: Fetcher,
  url: string,
  options: GetOptions,
): Promise<Uint8Array> => {
  const response = await get(fetcher, url, options);
  return await readBody(url, () => readCapped(response, options.maxBytes));
};

const getJson = async <TSchema extends GenericSchema>(
  fetcher: Fetcher,
  url: string,
  schema: TSchema,
  options: GetOptions,
): Promise<InferOutput<TSchema>> => {
  const bytes = await getBytes(fetcher, url, options);
  const body: unknown = await readBody(url, () => JSON.parse(DECODER.decode(bytes)));
  const parsed = safeParse(schema, body);
  if (!parsed.success) {
    throw new Error(`GET ${url} returned an unexpected response`);
  }
  return parsed.output;
};

export const createReleaseHttp = (userAgent: string, fetcher: Fetcher = fetch): ReleaseHttp => ({
  async latestGithubVersion() {
    const release = await getJson(fetcher, GITHUB_LATEST_RELEASE_URL, GithubLatestSchema, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": userAgent,
      },
      timeoutMs: METADATA_TIMEOUT_MS,
      maxBytes: METADATA_MAX_BYTES,
    });
    return versionFromTag(release.tag_name);
  },

  async latestNpmVersion() {
    const latest = await getJson(fetcher, NPM_LATEST_URL, NpmLatestSchema, {
      headers: { Accept: "application/json", "User-Agent": userAgent },
      timeoutMs: METADATA_TIMEOUT_MS,
      maxBytes: METADATA_MAX_BYTES,
    });
    return requireVersion(latest.version);
  },

  async downloadReleaseAsset(version, assetName) {
    return await getBytes(fetcher, releaseAssetUrl(version, assetName), {
      headers: { Accept: "application/octet-stream", "User-Agent": userAgent },
      timeoutMs: ASSET_TIMEOUT_MS,
      maxBytes: BINARY_MAX_BYTES,
    });
  },

  async downloadReleaseText(version, assetName) {
    const bytes = await getBytes(fetcher, releaseAssetUrl(version, assetName), {
      headers: { Accept: "text/plain", "User-Agent": userAgent },
      timeoutMs: METADATA_TIMEOUT_MS,
      maxBytes: CHECKSUM_MAX_BYTES,
    });
    return DECODER.decode(bytes);
  },
});

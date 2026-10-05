import { type GenericSchema, type InferOutput, object, safeParse, string } from "valibot";
import { messageOf } from "../domain/fatal-error.ts";
import {
  GITHUB_LATEST_RELEASE_URL,
  NPM_LATEST_URL,
  releaseAssetUrl,
  requireVersion,
  versionFromTag,
} from "../domain/self-update.ts";

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

const GithubLatestSchema = object({ tag_name: string() });
const NpmLatestSchema = object({ version: string() });

interface GetOptions {
  readonly headers: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
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

const get = async (fetcher: Fetcher, url: string, options: GetOptions): Promise<Response> => {
  const response = await send(fetcher, url, options);
  if (!response.ok) {
    throw new Error(`GET ${url} failed: HTTP ${response.status}`);
  }
  // Release downloads redirect to a CDN; `fetch` would follow one to plain HTTP.
  if (response.url.startsWith("http://")) {
    throw new Error(`GET ${url} failed: redirected to ${response.url}, which is not HTTPS`);
  }
  return response;
};

const readBody = async <T>(url: string, read: () => Promise<T>): Promise<T> => {
  try {
    return await read();
  } catch (error) {
    throw new Error(`GET ${url} failed while reading the response: ${messageOf(error)}`, {
      cause: error,
    });
  }
};

const getJson = async <TSchema extends GenericSchema>(
  fetcher: Fetcher,
  url: string,
  schema: TSchema,
  options: GetOptions,
): Promise<InferOutput<TSchema>> => {
  const response = await get(fetcher, url, options);
  const body: unknown = await readBody(url, () => response.json());
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
    });
    return versionFromTag(release.tag_name);
  },

  async latestNpmVersion() {
    const latest = await getJson(fetcher, NPM_LATEST_URL, NpmLatestSchema, {
      headers: { Accept: "application/json", "User-Agent": userAgent },
      timeoutMs: METADATA_TIMEOUT_MS,
    });
    return requireVersion(latest.version);
  },

  async downloadReleaseAsset(version, assetName) {
    const url = releaseAssetUrl(version, assetName);
    const response = await get(fetcher, url, {
      headers: { Accept: "application/octet-stream", "User-Agent": userAgent },
      timeoutMs: ASSET_TIMEOUT_MS,
    });
    return new Uint8Array(await readBody(url, () => response.arrayBuffer()));
  },

  async downloadReleaseText(version, assetName) {
    const url = releaseAssetUrl(version, assetName);
    const response = await get(fetcher, url, {
      headers: { Accept: "text/plain", "User-Agent": userAgent },
      timeoutMs: METADATA_TIMEOUT_MS,
    });
    return await readBody(url, () => response.text());
  },
});

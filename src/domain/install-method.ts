import { type MiseToolFacts, isHopBackend, isHopToolDirName } from "./mise-tool.ts";
import { baseName, parentDir } from "./posix-path.ts";

/**
 * Decides how this hop was installed, and therefore how `hop --update` may
 * update it. Gathering the facts (realpath, reading mise's marker file) is
 * infra's job; this layer only turns them into a decision, so the table in
 * `detectInstallMethod` stays unit-testable without touching the filesystem.
 *
 * Paths are POSIX: hop only ships for darwin/linux.
 */

/** The npm package name hop is published under. */
export const NPM_PACKAGE = "@n-seiji/nuthatch";

/** Facts about this hop process, gathered once by infra. */
export interface InstallFacts {
  /** Running as a `bun build --compile` binary. */
  readonly compiled: boolean;
  /** Real path of the compiled binary; null unless `compiled`. */
  readonly executablePath: string | null;
  /** Real path of the entry script; null when `compiled`. */
  readonly scriptPath: string | null;
  /**
   * The mise tool directory hop lives in, if any — any tool's, not
   * necessarily hop's: whether it is hop's is decided here (see mise-tool.ts).
   */
  readonly mise: MiseToolFacts | null;
  readonly platform: string;
  readonly arch: string;
}

/** Where the newest version a given install can actually reach is published. */
export type ReleaseChannel = "github" | "npm";

export type InstallMethod =
  | {
      readonly kind: "mise";
      readonly tool: string;
      readonly channel: ReleaseChannel;
    }
  | {
      readonly kind: "standalone";
      readonly binaryPath: string;
      readonly installDir: string;
      readonly assetName: string;
    }
  | { readonly kind: "npm" }
  | { readonly kind: "bun" }
  | { readonly kind: "unsupported"; readonly reason: string };

export type UpdatableMethod = Exclude<InstallMethod, { readonly kind: "unsupported" }>;

/** A compiled hop binary that hop can replace in place. */
export type StandaloneMethod = Extract<InstallMethod, { readonly kind: "standalone" }>;

/** The install methods whose update is another tool's own command. */
export type DelegatedMethod = Extract<InstallMethod, { readonly kind: "mise" | "npm" | "bun" }>;

/** A program plus its arguments; never a shell string. */
export type CommandArgv = readonly [string, ...string[]];

/** Release assets the release workflow attaches, by `<platform>-<arch>`. */
const RELEASE_ASSETS: ReadonlyMap<string, string> = new Map([
  ["darwin-arm64", "hop-darwin-arm64"],
  ["darwin-x64", "hop-darwin-x64"],
  ["linux-x64", "hop-linux-x64"],
]);

export const releaseAssetName = (platform: string, arch: string): string | null =>
  RELEASE_ASSETS.get(`${platform}-${arch}`) ?? null;

const NPX_MARKER = "/_npx/";
const BUNX_MARKER = "/bunx-";
const BUN_GLOBAL_MARKER = "/.bun/install/global/node_modules/";
/** The npm global prefix layout on unix: `<prefix>/lib/node_modules/<package>`. */
const NPM_GLOBAL_MARKER = `/lib/node_modules/${NPM_PACKAGE}/`;
const NODE_MODULES_MARKER = `/node_modules/${NPM_PACKAGE}/`;
const PNPM_GLOBAL_MARKER = "/pnpm/global/";
const YARN_GLOBAL_MARKER = "/yarn/global/";
const NPM_PACKAGE_LATEST = `${NPM_PACKAGE}@latest`;

const GITHUB_BACKEND_PREFIXES = ["github:", "ubi:", "aqua:"] as const;
const NPM_BACKEND_PREFIX = "npm:";

const unsupported = (reason: string): InstallMethod => ({
  kind: "unsupported",
  reason,
});

const miseChannel = (tool: string): ReleaseChannel | null => {
  if (tool.startsWith(NPM_BACKEND_PREFIX)) {
    return "npm";
  }
  return GITHUB_BACKEND_PREFIXES.some((prefix) => tool.startsWith(prefix)) ? "github" : null;
};

/**
 * A tool dir whose marker cannot be read. A name that says it is hop's is a
 * mise install of hop that hop cannot identify. A compiled binary anywhere
 * else in a tool dir is still inside a version manager's install dir (an
 * alias like `installs/hop/`, an asdf-style layout, …): replacing it there
 * would desync that manager's bookkeeping, so it is refused too. A script is
 * only *inside* such a dir (an npm global under asdf's `installs/nodejs`), so
 * the other rules still decide it.
 */
const detectUnmarkedToolDir = (dir: string, compiled: boolean): InstallMethod | null => {
  if (isHopToolDirName(baseName(dir))) {
    return unsupported(
      `installed by mise, but its backend is unknown (no readable marker in ${dir}); run "mise upgrade" yourself`,
    );
  }
  return compiled
    ? unsupported(
        `installed under a version manager's install dir (${dir}) without a readable mise marker; update it with the tool that installed it`,
      )
    : null;
};

/**
 * Whether mise installed hop: only if the tool dir hop lives in says so. A
 * readable marker for *another* tool (`core:node`, `core:bun`, …) means hop
 * is merely inside that tool's install — `npm i -g` on a mise-managed node —
 * so it is ignored and hop is classified by the other rules, as if mise were
 * not there. It does not mean "keep looking higher up": a path inside one
 * tool dir is never inside a second one that is hop's own.
 *
 * Null: not a mise install of hop, keep classifying.
 */
const detectMise = ({ mise, compiled }: InstallFacts): InstallMethod | null => {
  if (mise === null) {
    return null;
  }
  if (mise.backend === null) {
    return detectUnmarkedToolDir(mise.dir, compiled);
  }
  if (!isHopBackend(mise.backend)) {
    return null;
  }
  const channel = miseChannel(mise.backend);
  return channel === null
    ? unsupported(
        `mise installed hop through "${mise.backend}", which is neither a GitHub nor an npm backend; run "mise upgrade ${mise.backend}" yourself`,
      )
    : { kind: "mise", tool: mise.backend, channel };
};

const detectStandalone = (facts: InstallFacts): InstallMethod => {
  const { executablePath, platform, arch } = facts;
  if (executablePath === null) {
    return unsupported("cannot tell where the hop binary is installed");
  }
  const assetName = releaseAssetName(platform, arch);
  if (assetName === null) {
    return unsupported(
      `there is no prebuilt binary for ${platform}-${arch}; install with npm instead (npm i -g ${NPM_PACKAGE})`,
    );
  }
  return {
    kind: "standalone",
    binaryPath: executablePath,
    installDir: parentDir(executablePath),
    assetName,
  };
};

/**
 * A `node_modules/@n-seiji/nuthatch` that is not npm's global prefix layout:
 * pnpm's and yarn's globals (named, with their command, when the path shows
 * which one) or a dependency of some project. None of them is something
 * `npm install -g` would update.
 */
const otherNodeModulesReason = (scriptPath: string): string => {
  if (scriptPath.includes(PNPM_GLOBAL_MARKER)) {
    return `installed globally with pnpm, which hop does not drive; run "pnpm add -g ${NPM_PACKAGE_LATEST}" yourself`;
  }
  if (scriptPath.includes(YARN_GLOBAL_MARKER)) {
    return `installed globally with yarn, which hop does not drive; run "yarn global add ${NPM_PACKAGE_LATEST}" yourself`;
  }
  return "installed as a project dependency (a local node_modules); update it in that project";
};

const detectPackageInstall = (scriptPath: string): InstallMethod => {
  if (scriptPath.includes(NPX_MARKER)) {
    return unsupported(
      "running through npx, which already fetches the published version on every run",
    );
  }
  if (scriptPath.includes(BUNX_MARKER)) {
    return unsupported(
      "running through bunx, which already fetches the published version on every run",
    );
  }
  if (scriptPath.includes(BUN_GLOBAL_MARKER)) {
    return { kind: "bun" };
  }
  if (scriptPath.includes(NPM_GLOBAL_MARKER)) {
    return { kind: "npm" };
  }
  if (scriptPath.includes(NODE_MODULES_MARKER)) {
    return unsupported(otherNodeModulesReason(scriptPath));
  }
  return unsupported("running from a source checkout; update it with git (git pull)");
};

/**
 * First match wins, in this order: the mise tool dir hop lives in (a marker
 * that names hop; or, with no readable marker, a refusal for a hop-named dir
 * or a compiled binary — all of it beats the compiled / script heuristics,
 * since a mise install is itself a compiled binary or an npm package),
 * standalone binary, npx, bunx, bun global, npm global, any other
 * `node_modules` copy (refused), source checkout.
 */
export const detectInstallMethod = (facts: InstallFacts): InstallMethod => {
  const mise = detectMise(facts);
  if (mise !== null) {
    return mise;
  }
  // No script path at all reads as a source checkout, like any unrecognised path.
  return facts.compiled ? detectStandalone(facts) : detectPackageInstall(facts.scriptPath ?? "");
};

export const latestChannel = (method: UpdatableMethod): ReleaseChannel => {
  if (method.kind === "mise") {
    return method.channel;
  }
  return method.kind === "standalone" ? "github" : "npm";
};

/** The package manager's own upgrade command, as the user could type it. */
export const upgradeCommand = (method: DelegatedMethod): CommandArgv => {
  if (method.kind === "mise") {
    return ["mise", "upgrade", method.tool];
  }
  return method.kind === "npm"
    ? ["npm", "install", "-g", NPM_PACKAGE_LATEST]
    : ["bun", "add", "-g", NPM_PACKAGE_LATEST];
};

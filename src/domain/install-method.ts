import { managerRootReason } from "./install-roots.ts";
import { type ScriptInstall, detectScriptInstall } from "./install-script.ts";
import {
  type MiseToolFacts,
  isHopBackend,
  isHopToolDirName,
  withoutToolOptions,
} from "./mise-tool.ts";
import { baseName, parentDir } from "./posix-path.ts";
import { NPM_PACKAGE, NPM_PACKAGE_LATEST } from "./self-update.ts";

/**
 * Decides how this hop was installed, and therefore how `hop --update` may
 * update it. Gathering the facts (realpath, reading mise's marker file) is
 * infra's job; this layer only turns them into a decision, so the table in
 * `detectInstallMethod` stays unit-testable without touching the filesystem.
 *
 * Paths are POSIX: hop only ships for darwin/linux.
 */

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
  /**
   * The npm global prefix the script is verified to live in: it sits at
   * `<prefix>/lib/node_modules/@n-seiji/nuthatch/` and `<prefix>/bin/hop`
   * links back to this very script. Null for anything else — including a
   * project's own `lib/node_modules`, which only looks the same.
   */
  readonly npmGlobalPrefix: string | null;
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
  | ScriptInstall;

export type UpdatableMethod = Exclude<InstallMethod, { readonly kind: "unsupported" }>;

/** A compiled hop binary that hop can replace in place. */
export type StandaloneMethod = Extract<InstallMethod, { readonly kind: "standalone" }>;

/** The install methods whose update is another tool's own command. */
export type DelegatedMethod = Extract<InstallMethod, { readonly kind: "mise" | "npm" | "bun" }>;

/** An install that mise put there. */
export type MiseMethod = Extract<InstallMethod, { readonly kind: "mise" }>;

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

const insideVersionManager = (dir: string, marker: string): InstallMethod =>
  unsupported(
    `installed under a version manager's install dir (${dir}) ${marker}; update it with the tool that installed it`,
  );

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
  return compiled ? insideVersionManager(dir, "without a readable mise marker") : null;
};

/**
 * Whether mise installed hop: only if the tool dir hop lives in says so. A
 * readable marker for *another* tool (`core:node`, `core:bun`, …) means hop
 * is merely inside that tool's install. For a script (`npm i -g` on a
 * mise-managed node) that marker is ignored and hop is classified by the
 * other rules, as if mise were not there; a compiled binary there is the same
 * case as an unreadable marker and is refused. Neither keeps looking higher
 * up: a path inside one tool dir is never inside a second one that is hop's
 * own.
 *
 * The marker's id may carry options (`github:n-seiji/nuthatch[bin=hop]`);
 * they are not part of the tool's name, for matching or for `mise upgrade`.
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
  const tool = withoutToolOptions(mise.backend);
  if (!isHopBackend(tool)) {
    return compiled
      ? insideVersionManager(mise.dir, `whose marker names "${tool}", not hop`)
      : null;
  }
  const channel = miseChannel(tool);
  return channel === null
    ? unsupported(
        `mise installed hop through "${tool}", which is neither a GitHub nor an npm backend; run "mise upgrade ${tool}" yourself`,
      )
    : { kind: "mise", tool, channel };
};

const detectStandalone = (facts: InstallFacts): InstallMethod => {
  const { executablePath, platform, arch } = facts;
  if (executablePath === null) {
    return unsupported("cannot tell where the hop binary is installed");
  }
  const managedBy = managerRootReason(executablePath);
  if (managedBy !== null) {
    return unsupported(managedBy);
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
 * First match wins, in this order: the mise tool dir hop lives in (a marker
 * that names hop; or, for a compiled binary, a refusal whenever it is not
 * hop's own marker — all of it beats the compiled / script heuristics, since a
 * mise install is itself a compiled binary or an npm package), a compiled
 * binary inside a package manager's own tree (refused), standalone binary,
 * npx, bunx, bun global, verified npm global (refused when its prefix is
 * inside Homebrew's or Nix's own tree), any other `node_modules` copy
 * (refused), source checkout.
 */
export const detectInstallMethod = (facts: InstallFacts): InstallMethod => {
  const mise = detectMise(facts);
  if (mise !== null) {
    return mise;
  }
  // No script path at all reads as a source checkout, like any unrecognised path.
  return facts.compiled
    ? detectStandalone(facts)
    : detectScriptInstall(facts.scriptPath ?? "", facts.npmGlobalPrefix);
};

export const latestChannel = (method: UpdatableMethod): ReleaseChannel => {
  if (method.kind === "mise") {
    return method.channel;
  }
  return method.kind === "standalone" ? "github" : "npm";
};

/**
 * The package manager's own upgrade command, as the user could type it. npm
 * gets the prefix hop lives in explicitly: a bare `npm install -g` lands in
 * the prefix of whichever `npm` runs, which with several nodes installed (nvm,
 * mise, Homebrew) need not be hop's, leaving the old hop in place.
 */
export const upgradeCommand = (method: DelegatedMethod): CommandArgv => {
  if (method.kind === "mise") {
    return ["mise", "upgrade", method.tool];
  }
  return method.kind === "npm"
    ? ["npm", "install", "-g", "--prefix", method.prefix, NPM_PACKAGE_LATEST]
    : ["bun", "add", "-g", NPM_PACKAGE_LATEST];
};

/**
 * The question to put to mise before `upgradeCommand`, changing nothing:
 * `mise upgrade` exits 0 whether or not it moved anything (a pinned version,
 * `minimum_release_age`, a tool outside the active config), while `mise
 * upgrade --dry-run-code <tool>` exits 1 when it would upgrade the tool and 0
 * when it would not. npm and bun have no such question.
 */
export const miseDryRunCommand = (method: MiseMethod): CommandArgv => [
  "mise",
  "upgrade",
  "--dry-run-code",
  method.tool,
];

/**
 * Where to look for the upgrade command's program before PATH: npm's own
 * `bin`, so the `npm` that runs is the one belonging to the node hop's
 * prefix came from.
 */
export const preferredProgramDir = (method: DelegatedMethod): string | null =>
  method.kind === "npm" ? `${method.prefix}/bin` : null;

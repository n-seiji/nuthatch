import { parentDir } from "./posix-path.ts";

/**
 * Decides how this hop was installed, and therefore whether `hop --update`
 * may replace it. Only a compiled standalone binary (what install.sh puts
 * down) is replaced; every other install is told how to update itself and is
 * never touched. Infra gathers the facts, this layer only decides.
 * Paths are POSIX and already realpath'd.
 */

/** Facts about this hop process, gathered once by infra. */
export interface InstallFacts {
  /** Running as a `bun build --compile` binary. */
  readonly compiled: boolean;
  /** Real path of the compiled binary; null unless `compiled`. */
  readonly executablePath: string | null;
  /** Real path of the entry script; null when `compiled`. */
  readonly scriptPath: string | null;
  readonly platform: string;
  readonly arch: string;
}

/** The ways hop can be installed that hop does not drive. */
export type ForeignKind = "mise" | "package-manager" | "other";

export type InstallMethod =
  | {
      readonly kind: "standalone";
      readonly binaryPath: string;
      readonly installDir: string;
      readonly assetName: string;
    }
  | { readonly kind: ForeignKind };

/** A compiled hop binary that hop can replace in place. */
export type StandaloneMethod = Extract<InstallMethod, { readonly kind: "standalone" }>;

/** Release assets the release workflow attaches, by `<platform>-<arch>`. */
const RELEASE_ASSETS: ReadonlyMap<string, string> = new Map([
  ["darwin-arm64", "hop-darwin-arm64"],
  ["darwin-x64", "hop-darwin-x64"],
  ["linux-x64", "hop-linux-x64"],
]);

/**
 * Trees that keep their own copy of a binary. Replacing one in place would
 * leave that tool's bookkeeping describing a version that is gone (and the
 * Nix store is read-only), so they are refused like any other managed install.
 */
const MANAGED_TREES = [
  "/Cellar/",
  "/Caskroom/",
  "/nix/store/",
  "/aquaproj-aqua/",
  "/aqua/pkgs/",
  "/.proto/",
  "/installs/",
] as const;

const MISE_TREE = "/mise/installs/";
const NODE_MODULES = "/node_modules/";

/**
 * First match wins. A mise tree beats everything, since a mise install is
 * either a compiled binary or an npm package. A script under `node_modules`
 * is a package-manager install (npm / bun global, npx). A compiled binary is
 * standalone unless it sits in a managed tree or has no prebuilt asset for
 * this platform. Anything else, a source checkout included, is `other`.
 */
export const detectInstallMethod = (facts: InstallFacts): InstallMethod => {
  const path = (facts.compiled ? facts.executablePath : facts.scriptPath) ?? "";
  if (path.includes(MISE_TREE)) {
    return { kind: "mise" };
  }
  if (!facts.compiled) {
    return { kind: path.includes(NODE_MODULES) ? "package-manager" : "other" };
  }
  const assetName = RELEASE_ASSETS.get(`${facts.platform}-${facts.arch}`);
  if (assetName === undefined || MANAGED_TREES.some((tree) => path.includes(tree))) {
    return { kind: "other" };
  }
  return {
    kind: "standalone",
    binaryPath: path,
    installDir: parentDir(path),
    assetName,
  };
};

/** The command a user would run to update a non-standalone install; null when hop cannot name one. */
export const suggestedCommand = (kind: ForeignKind): readonly string[] | null => {
  if (kind === "mise") {
    return ["mise", "upgrade"];
  }
  return kind === "package-manager" ? ["npm", "i", "-g", "@n-seiji/nuthatch@latest"] : null;
};

/** The one line telling the user how to update an install hop does not replace. */
export const updateHint = (kind: ForeignKind): string => {
  const command = suggestedCommand(kind)?.join(" ");
  if (kind === "mise") {
    return `Update with mise: ${command}`;
  }
  return kind === "package-manager"
    ? `Update with your package manager, e.g. ${command}`
    : "Update hop with the tool you installed it with.";
};

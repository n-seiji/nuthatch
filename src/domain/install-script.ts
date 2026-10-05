import { NPM_PACKAGE, NPM_PACKAGE_LATEST } from "./self-update.ts";

/**
 * Classifies a hop that runs as a script (the npm build, `bun run
 * src/cli.ts`): which tool put it where it is, judged from its real path
 * alone. Paths are POSIX: hop only ships for darwin/linux.
 */

/** The install methods a script path can resolve to. */
export type ScriptInstall =
  | { readonly kind: "npm"; readonly prefix: string }
  | { readonly kind: "bun" }
  | { readonly kind: "unsupported"; readonly reason: string };

const NPX_MARKER = "/_npx/";
const BUNX_MARKER = "/bunx-";
const BUN_GLOBAL_MARKER = "/.bun/install/global/node_modules/";
/** The npm global prefix layout on unix: `<prefix>/lib/node_modules/<package>`. */
const NPM_GLOBAL_MARKER = `/lib/node_modules/${NPM_PACKAGE}/`;
const NODE_MODULES_MARKER = `/node_modules/${NPM_PACKAGE}/`;
const PNPM_GLOBAL_MARKER = "/pnpm/global/";
const YARN_GLOBAL_MARKER = "/yarn/global/";

const unsupported = (reason: string): ScriptInstall => ({ kind: "unsupported", reason });

/**
 * The npm global prefix `scriptPath` would belong to if it were an npm global
 * install: everything before the package's own `/lib/node_modules/<package>/`
 * (the last such segment, the one the script sits in). Only text, though —
 * any project can have a `lib/node_modules` of its own, so infra must still
 * confirm that `<prefix>/bin/hop` is the link npm made to this very script.
 * Null when the path has no such segment or the prefix would be empty.
 */
export const npmGlobalPrefixOf = (scriptPath: string): string | null => {
  const index = scriptPath.lastIndexOf(NPM_GLOBAL_MARKER);
  return index > 0 ? scriptPath.slice(0, index) : null;
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

/**
 * `npmGlobalPrefix` is the prefix infra verified (see InstallFacts), not what
 * the path alone suggests: a path that merely looks like npm's global layout
 * falls through to the `node_modules` refusal below.
 */
export const detectScriptInstall = (
  scriptPath: string,
  npmGlobalPrefix: string | null,
): ScriptInstall => {
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
  if (npmGlobalPrefix !== null) {
    return { kind: "npm", prefix: npmGlobalPrefix };
  }
  if (scriptPath.includes(NODE_MODULES_MARKER)) {
    return unsupported(otherNodeModulesReason(scriptPath));
  }
  return unsupported("running from a source checkout; update it with git (git pull)");
};

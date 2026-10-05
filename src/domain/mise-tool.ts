import { baseName, parentDir } from "./posix-path.ts";

/**
 * The pure half of recognising a mise install. mise keeps each tool under
 * `<mise data dir>/installs/<tool>/<version>/…` and records in the tool dir
 * how it was installed. Reading that marker is infra's job; where the tool dir
 * is, what the two marker formats look like, and whether the tool is *hop*
 * are decided here, so they stay unit-testable without a filesystem.
 *
 * The last point matters because `installs/` also holds the tools hop merely
 * lives inside: an `npm i -g` on a mise-managed node puts hop under
 * `installs/node/<version>/lib/node_modules/…`, next to node's own marker
 * (`core:node`). That marker says nothing about hop.
 */

/** The mise tool directory hop lives in, and what its marker records. */
export interface MiseToolFacts {
  /** `<mise data dir>/installs/<tool>`. */
  readonly dir: string;
  /**
   * The backend id (`full`) the marker records — `.mise.backend.toml`, else
   * the older `.mise.backend` — of *whatever* tool this is. Null when neither
   * file is readable or names a backend.
   */
  readonly backend: string | null;
}

/** How far above hop's path the mise tool directory is searched for. */
const MISE_WALK_LIMIT = 8;

/**
 * A backend id that names hop's own repository / package, whatever the
 * backend: `github:n-seiji/nuthatch`, `ubi:…`, `aqua:…`, `npm:@n-seiji/nuthatch`.
 */
const HOP_BACKEND_PATTERN = /^[a-z0-9_-]+:@?n-seiji\/nuthatch$/iu;

/**
 * The dir of a tool installed with an explicit backend is named after its id,
 * with the punctuation turned into `-`: `github-n-seiji-nuthatch`,
 * `npm-n-seiji-nuthatch`.
 */
const HOP_TOOL_DIR_PATTERN = /(?:^|-)n-seiji-nuthatch$/iu;

/** Pulls the `full = "<backend>"` entry out of mise's `.mise.backend.toml`. */
export const parseMiseBackendToml = (text: string): string | null => {
  const match = /^\s*full\s*=\s*"(?<tool>[^"]+)"\s*$/mu.exec(text);
  return match?.groups?.tool ?? null;
};

/**
 * Reads mise's older plain-text marker, `.mise.backend`: two lines, the short
 * name the tool was requested by and then its full backend id
 * (`claude-code` / `npm:@anthropic-ai/claude-code`). For an explicit backend
 * both lines are the same, which is why the last line — not the first — is
 * the id: a tool added under an alias would otherwise read as its alias.
 */
export const parseLegacyMiseBackend = (text: string): string | null => {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.at(-1) ?? null;
};

/** True when `backend` (a marker's `full`) names hop rather than some other tool. */
export const isHopBackend = (backend: string): boolean => HOP_BACKEND_PATTERN.test(backend);

/** True when a tool dir's name says it is hop's, for use when no marker can be read. */
export const isHopToolDirName = (name: string): boolean => HOP_TOOL_DIR_PATTERN.test(name);

const ancestorDirs = (path: string, limit: number): readonly string[] => {
  const dirs: string[] = [];
  let dir = parentDir(path);
  while (dirs.length < limit && dir !== "/" && dir !== ".") {
    dirs.push(dir);
    dir = parentDir(dir);
  }
  return dirs;
};

/**
 * The mise tool dir `path` lives in: the nearest ancestor (at most 8 levels up)
 * that sits directly inside an `installs` dir. Only the nearest counts — a
 * path already inside one tool's dir is never inside a second, hop's own, one
 * further up — so whatever that dir says (hop's marker, another tool's, none)
 * is the whole answer.
 */
export const miseToolDir = (path: string): string | null =>
  ancestorDirs(path, MISE_WALK_LIMIT).find((dir) => baseName(parentDir(dir)) === "installs") ??
  null;

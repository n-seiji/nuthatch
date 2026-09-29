/**
 * Decides *where* the git executable may live. hop resolves git to an
 * absolute path itself instead of handing the bare name "git" to
 * `child_process` and hoping the spawn implementation searches PATH the way
 * we expect: a compiled Bun binary reported `ENOENT: no such file or
 * directory, posix_spawn 'git'` on macOS even with git installed
 * (see issue #9), and a GUI-launched shell can easily miss the dir git was
 * installed into. Probing the filesystem is infra's job (this layer stays
 * pure); this module only produces the ordered candidate list and the
 * user-facing message when none of them exists.
 *
 * Paths are POSIX-joined: hop only ships for darwin/linux.
 */

/** Env var that overrides the search entirely (absolute path to a git binary). */
export const GIT_EXECUTABLE_OVERRIDE_ENV = "HOP_GIT";

/** `code` on the error thrown when no candidate turned out to be executable. */
export const GIT_NOT_FOUND_ERROR_CODE = "HOP_GIT_NOT_FOUND";

/** The remediation every "hop cannot run git" message ends with. */
export const GIT_NOT_FOUND_HINT =
  `Install git, or set ${GIT_EXECUTABLE_OVERRIDE_ENV} to its absolute path.` as const;

/**
 * Searched after PATH, so hop keeps working when it is launched with a PATH
 * that never went through the user's shell profile (Homebrew first, since
 * that is where a macOS git usually comes from).
 */
export const GIT_FALLBACK_BIN_DIRS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
] as const;

interface GitExecutableCandidatesInput {
  /** Value of HOP_GIT, if set. */
  readonly override?: string | undefined;
  /** Value of PATH, if set. */
  readonly path?: string | undefined;
}

const PATH_SEPARATOR = ":";

const joinBin = (dir: string): string => {
  const base = dir.endsWith("/") ? dir.slice(0, -1) : dir;
  return `${base}/git`;
};

/**
 * Absolute candidate paths in the order they should be probed. A PATH entry
 * that is not absolute (`.`, `node_modules/.bin`) is dropped rather than
 * resolved against the cwd: hop runs git inside whatever worktree it was
 * pointed at, and a repo-relative `git` there would be someone else's code.
 */
export const gitExecutableCandidates = (input: GitExecutableCandidatesInput): readonly string[] => {
  const override = input.override?.trim() ?? "";
  if (override.length > 0) {
    return [override];
  }

  const dirs = (input.path ?? "")
    .split(PATH_SEPARATOR)
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith("/"));

  return [...new Set([...dirs, ...GIT_FALLBACK_BIN_DIRS].map((dir) => joinBin(dir)))];
};

/** Error text for "git is nowhere to be found" — names every place hop looked. */
export const gitNotFoundMessage = (candidates: readonly string[]): string =>
  `git executable not found. Looked in: ${candidates.join(", ")}. ${GIT_NOT_FOUND_HINT}`;

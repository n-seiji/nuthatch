import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { InstallFactsSource } from "../infra/install-facts.ts";

/**
 * Building blocks for tests that lay an install out on disk, in a tmpdir,
 * and read its facts back (infra/install-facts.ts).
 */

/** A scratch dir, already realpath'd: macOS's tmpdir is itself a symlink (/var -> /private/var). */
export const createLayoutSandbox = async (): Promise<string> => {
  const created = await mkdtemp(join(tmpdir(), "nuthatch-install-facts-"));
  return realpath(created);
};

/** Writes `content` to `path`, creating its parent directories. */
export const touch = async (path: string, content = ""): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
};

/** The process facts of a hop run: an uncompiled run of an unknown script unless overridden. */
export const installSourceOf = (
  overrides: Partial<InstallFactsSource> = {},
): InstallFactsSource => ({
  compiled: false,
  execPath: "/usr/bin/node",
  argv1: undefined,
  platform: "darwin",
  arch: "arm64",
  ...overrides,
});

/** The `.mise.backend.toml` mise writes for `tool`, installed with an explicit backend. */
export const miseBackendToml = (tool: string): string =>
  `short = "${tool}"\nfull = "${tool}"\nexplicit_backend = true`;

/**
 * The npm global layout of hop under `root` (`<prefix>`): the package's script
 * and the `bin/hop` link npm creates next to it. Returns both paths.
 */
export const createNpmGlobalHop = async (
  root: string,
): Promise<{ readonly script: string; readonly bin: string }> => {
  const script = join(root, "lib/node_modules/@n-seiji/nuthatch/dist/cli.js");
  const bin = join(root, "bin", "hop");
  await touch(script);
  await mkdir(dirname(bin), { recursive: true });
  await symlink("../lib/node_modules/@n-seiji/nuthatch/dist/cli.js", bin);
  return { script, bin };
};

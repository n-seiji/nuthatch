import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import {
  GIT_EXECUTABLE_OVERRIDE_ENV,
  GIT_NOT_FOUND_ERROR_CODE,
  gitExecutableCandidates,
  gitNotFoundMessage,
} from "../domain/git-executable.ts";

/**
 * Probes domain/git-executable.ts's candidate list and hands git.ts an
 * absolute path to spawn. hop never spawns the bare name "git": see the
 * module comment there for why PATH resolution is done here rather than left
 * to the spawn implementation.
 */

const isExecutableFile = async (path: string): Promise<boolean> => {
  try {
    const stats = await stat(path);
    if (!stats.isFile()) {
      return false;
    }
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** Throws an Error whose `code` is GIT_NOT_FOUND_ERROR_CODE when nothing matched. */
const resolveGitExecutable = async (env: NodeJS.ProcessEnv): Promise<string> => {
  const candidates = gitExecutableCandidates({
    override: env[GIT_EXECUTABLE_OVERRIDE_ENV],
    path: env.PATH,
  });
  /*
   * Every probe is launched at once (a handful of stat calls, and awaiting
   * them one by one serialises the fs threadpool), then awaited in candidate
   * order so the first entry on PATH wins and nothing waits past it.
   */
  const probes = candidates.map(async (candidate) =>
    (await isExecutableFile(candidate)) ? candidate : undefined,
  );
  for (const probe of probes) {
    // oxlint-disable-next-line no-await-in-loop
    const found = await probe;
    if (found !== undefined) {
      return found;
    }
  }
  throw Object.assign(new Error(gitNotFoundMessage(candidates)), {
    code: GIT_NOT_FOUND_ERROR_CODE,
  });
};

/**
 * Resolves lazily and remembers the answer (including a failure) for the
 * lifetime of the port: one hop invocation runs many git calls, and the
 * candidate list can't change under it mid-run.
 */
export const createGitExecutableResolver = (env: NodeJS.ProcessEnv): (() => Promise<string>) => {
  let cached: Promise<string> | null = null;
  return () => {
    cached ??= resolveGitExecutable(env);
    return cached;
  };
};

import {
  GIT_EXECUTABLE_OVERRIDE_ENV,
  GIT_NOT_FOUND_ERROR_CODE,
  gitExecutableCandidates,
  gitNotFoundMessage,
} from "../domain/git-executable.ts";
import { firstExecutable } from "./executable.ts";

/**
 * Probes domain/git-executable.ts's candidate list and hands git.ts an
 * absolute path to spawn. hop never spawns the bare name "git": see the
 * module comment there for why PATH resolution is done here rather than left
 * to the spawn implementation.
 */

/** Throws an Error whose `code` is GIT_NOT_FOUND_ERROR_CODE when nothing matched. */
const resolveGitExecutable = async (env: NodeJS.ProcessEnv): Promise<string> => {
  const candidates = gitExecutableCandidates({
    override: env[GIT_EXECUTABLE_OVERRIDE_ENV],
    path: env.PATH,
  });
  const found = await firstExecutable(candidates);
  if (found !== null) {
    return found;
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

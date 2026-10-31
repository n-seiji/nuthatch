import { type CommandResult, EXIT_USAGE_ERROR, fail } from "./result.ts";

/**
 * True for a branch/ref name git would parse as an option (leading "-"). Such
 * a name must never reach git's argv: `worktree add` re-parses it as an option
 * of its inner `git branch` call, and `--end-of-options` does not protect it.
 */
export const isOptionLikeRef = (name: string): boolean => name.startsWith("-");

/** The usage-error rejection for an option-like branch or ref, or null when `name` is usable. */
export const optionLikeRefRejection = <T>(label: string, name: string): CommandResult<T> | null =>
  isOptionLikeRef(name)
    ? fail(
        EXIT_USAGE_ERROR,
        `Refusing ${label} "${name}": names starting with "-" would be parsed as git options.`,
      )
    : null;

/** Rejects an option-like branch or --track ref before it can reach git's argv. */
export const refArgumentRejection = <T>(
  branch: string,
  track: string | undefined,
): CommandResult<T> | null =>
  optionLikeRefRejection<T>("branch", branch) ??
  (track === undefined ? null : optionLikeRefRejection<T>("--track ref", track));

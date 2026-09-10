import { defineCommand } from "citty";
import { root } from "./commands/root.ts";
import type { CommandResult } from "./domain/result.ts";
import type { FsPort, GitPort } from "./domain/ports.ts";
import { render } from "./render.ts";

/**
 * Citty's positional-arg parser special-cases a bare "-" token (treating it
 * like a stdin marker) and drops it, leaving `args.branch` undefined instead
 * of "-" — so `hop root -` would silently fall through to the bare "just
 * report the path" branch instead of switching back to the previous branch.
 *
 * `rewriteRootPreviousToken` rewrites a leading "-" to this sentinel
 * *before* citty ever parses the args; this module's `run()` maps the
 * sentinel back to "-" once citty has handed the parsed args over.
 */
export const ROOT_PREVIOUS_TOKEN = " hop-root-previous ";

export const rewriteRootPreviousToken = (args: readonly string[]): string[] =>
  args[0] === "-" ? [ROOT_PREVIOUS_TOKEN, ...args.slice(1)] : [...args];

const resolveRootTarget = (branch: unknown): unknown =>
  branch === ROOT_PREVIOUS_TOKEN ? "-" : branch;

export const createRootCommand = (
  git: GitPort,
  fs: FsPort,
  applyExitCode: <T>(result: CommandResult<T>) => void,
) =>
  defineCommand({
    meta: {
      name: "root",
      description: "cd to the root clone, or temporarily switch its branch",
    },
    args: {
      branch: {
        type: "positional",
        required: false,
        description: 'Branch to switch root to ("-" to switch back)',
      },
      track: {
        type: "string",
        description: "Remote branch to track when creating",
      },
      json: { type: "boolean", description: "Output JSON" },
    },
    async run({ args }) {
      const target = resolveRootTarget(args.branch);
      const result = await root(git, fs, {
        cwd: process.cwd(),
        ...(target === undefined ? {} : { target: String(target) }),
        ...(args.track === undefined ? {} : { track: String(args.track) }),
      });
      render("root", result, Boolean(args.json));
      applyExitCode(result);
    },
  });

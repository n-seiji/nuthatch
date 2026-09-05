#!/usr/bin/env node
import { type ArgsDef, type CommandDef, defineCommand, parseArgs, runCommand } from "citty";
import { dispatchCliArgs, isHelpRequest, normalizeCliArgs } from "./cli-dispatch.ts";
import {
  createPickerCallbacks,
  loadPickCandidates,
  renderSwitchRootOutcome,
  runInteractivePicker,
} from "./cli-pick.ts";
import { clean } from "./commands/clean.ts";
import { renderInit } from "./commands/init.ts";
import { jump } from "./commands/jump.ts";
import { ls } from "./commands/ls.ts";
import { rm } from "./commands/rm.ts";
import { root } from "./commands/root.ts";
import { type CommandResult, EXIT_CANCELLED, EXIT_USAGE_ERROR, ok } from "./domain/result.ts";
import { createFsPort } from "./infra/fs.ts";
import { createGitPort } from "./infra/git.ts";
import { createTermPort } from "./infra/term.ts";
import { render } from "./render.ts";
import { USAGE } from "./usage.ts";

const git = createGitPort();
const fs = createFsPort();
const term = createTermPort();

const applyExitCode = <T>(result: CommandResult<T>): void => {
  process.exitCode = result.exitCode;
};

const lsCommand = defineCommand({
  meta: { name: "ls", description: "List worktrees" },
  args: {
    json: { type: "boolean", description: "Output JSON" },
  },
  async run({ args }) {
    const result = await ls(git, fs, { cwd: process.cwd() });
    render("ls", result, Boolean(args.json));
    applyExitCode(result);
  },
});

const rmCommand = defineCommand({
  meta: { name: "rm", description: "Remove a worktree (keeps the branch)" },
  args: {
    branch: {
      type: "positional",
      required: true,
      description: "Branch to remove",
    },
    force: { type: "boolean", description: "Force removal even if dirty" },
    ext: {
      type: "boolean",
      description: "Allow removing an external worktree",
    },
    json: { type: "boolean", description: "Output JSON" },
  },
  async run({ args }) {
    const result = await rm(git, fs, {
      cwd: process.cwd(),
      branch: String(args.branch),
      force: Boolean(args.force),
      ext: Boolean(args.ext),
    });
    render("rm", result, Boolean(args.json));
    applyExitCode(result);
  },
});

const rootCommand = defineCommand({
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
    const result = await root(git, fs, {
      cwd: process.cwd(),
      ...(args.branch === undefined ? {} : { target: String(args.branch) }),
      ...(args.track === undefined ? {} : { track: String(args.track) }),
    });
    render("root", result, Boolean(args.json));
    applyExitCode(result);
  },
});

const cleanCommand = defineCommand({
  meta: {
    name: "clean",
    description: "Remove worktrees that are safe to garbage-collect",
  },
  args: {
    ext: { type: "boolean", description: "Also consider external worktrees" },
    withBranch: { type: "boolean", description: "Also delete the branch" },
    dryRun: { type: "boolean", description: "Only report candidates" },
    yes: { type: "boolean", description: "Skip confirmation and execute" },
    json: { type: "boolean", description: "Output JSON" },
  },
  async run({ args }) {
    const result = await clean(git, fs, term, {
      cwd: process.cwd(),
      ext: Boolean(args.ext),
      withBranch: Boolean(args.withBranch),
      dryRun: Boolean(args.dryRun),
      yes: Boolean(args.yes),
    });
    render("clean", result, Boolean(args.json));
    applyExitCode(result);
  },
});

const initCommand = defineCommand({
  meta: { name: "init", description: "Print shell integration" },
  args: {
    shell: {
      type: "positional",
      required: true,
      description: "Shell name (zsh)",
    },
  },
  run({ args }) {
    const shell = String(args.shell);
    if (shell !== "zsh") {
      process.stderr.write(`Unsupported shell: ${shell}\n`);
      process.exitCode = EXIT_USAGE_ERROR;
      return;
    }
    process.stdout.write(renderInit({ shell: "zsh" }));
  },
});

const runJump = async (
  target: string,
  options: { create: boolean; track?: string; json: boolean },
): Promise<void> => {
  const result = await jump(git, fs, term, {
    cwd: process.cwd(),
    target,
    create: options.create,
    ...(options.track === undefined ? {} : { track: options.track }),
  });
  render("jump", result, options.json);
  applyExitCode(result);
};

const RESERVED_COMMANDS = {
  ls: lsCommand,
  rm: rmCommand,
  clean: cleanCommand,
  root: rootCommand,
  init: initCommand,
} as const;

const jumpArgsSchema = {
  target: {
    type: "positional",
    required: false,
    description: "Branch to jump to",
  },
  create: {
    type: "boolean",
    description: "Create the worktree if it doesn't exist",
  },
  track: {
    type: "string",
    description: "Remote branch to track when creating",
  },
  json: { type: "boolean", description: "Output JSON" },
} as const;

/**
 * Runs the interactive picker (TTY only). Loads ink lazily via a literal
 * dynamic import path (in cli-pick.ts) so non-TTY runs never touch
 * ink/react at all; falls back to the plain readline-based picker if ink
 * fails to load or render (e.g. a `bun build --compile` binary where ink's
 * native pieces don't work). Mutation wiring (delete / switch root here)
 * lives in cli-pick.ts — see its module comment for why.
 */
const runInteractivePick = async (json: boolean): Promise<void> => {
  const candidates = await loadPickCandidates(git, fs, json);
  if (candidates === null) {
    return;
  }

  let lastSwitchedBranch: string | null = null;
  const callbacks = createPickerCallbacks(git, fs, json, (branch) => {
    lastSwitchedBranch = branch;
  });

  const outcome = await runInteractivePicker(candidates, callbacks);
  if (outcome === null) {
    process.exitCode = EXIT_CANCELLED;
    return;
  }

  if (outcome.type === "path") {
    renderSwitchRootOutcome(outcome.path, lastSwitchedBranch, json);
    return;
  }

  const selected = outcome.candidate;
  if (selected.kind === "worktree") {
    const result = ok({
      path: selected.worktree.path,
      data: { branch: selected.worktree.branch, created: false },
    });
    if (json) {
      render("pick", result, true);
    } else {
      process.stdout.write(`${selected.worktree.path}\n`);
    }
    return;
  }

  await runJump(selected.branch, { create: true, json });
};

const runJumpFromArgs = async (rawArgs: readonly string[]): Promise<void> => {
  const args = parseArgs([...rawArgs], jumpArgsSchema);
  if (args.target === undefined) {
    if (term.isTTY()) {
      await runInteractivePick(Boolean(args.json));
      return;
    }
    // Non-TTY: no picker, just list worktrees.
    const result = await ls(git, fs, { cwd: process.cwd() });
    render("ls", result, Boolean(args.json));
    applyExitCode(result);
    return;
  }
  await runJump(String(args.target), {
    create: Boolean(args.create),
    json: Boolean(args.json),
    ...(args.track === undefined ? {} : { track: String(args.track) }),
  });
};

// Dispatch is manual (not citty's `subCommands`) because citty's runCommand
// Always invokes a parent's `run` even after dispatching a subcommand, and
// Throws on any unrecognized first token — both wrong for us, since any
// Non-reserved first token must fall through to `jump` as a branch name.
// Process.argv is [node, script, ...userArgs]; drop the first two.
const ARGV_USER_ARGS_START = 2;
const rawArgs = normalizeCliArgs(
  process.argv.slice(ARGV_USER_ARGS_START),
  process.argv0,
  process.stdout.isTTY === true,
);

if (isHelpRequest(rawArgs)) {
  process.stderr.write(USAGE);
  process.exitCode = 0;
} else {
  const dispatch = dispatchCliArgs(rawArgs, Object.keys(RESERVED_COMMANDS));
  if (dispatch.kind === "reserved") {
    const command = RESERVED_COMMANDS[dispatch.name as keyof typeof RESERVED_COMMANDS];
    // The command union's arg schemas differ per command, so this cast collapses
    // Them to the common CommandDef<ArgsDef> shape runCommand expects.
    await runCommand(command as unknown as CommandDef<ArgsDef>, {
      rawArgs: [...dispatch.args],
    });
  } else {
    await runJumpFromArgs(dispatch.args);
  }
}

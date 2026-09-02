#!/usr/bin/env node
import { defineCommand, parseArgs, runCommand } from "citty";
import { renderInit } from "./commands/init.ts";
import { jump } from "./commands/jump.ts";
import { ls } from "./commands/ls.ts";
import { rm } from "./commands/rm.ts";
import type { CommandResult } from "./domain/result.ts";
import { createFsPort } from "./infra/fs.ts";
import { createGitPort } from "./infra/git.ts";
import { createTermPort } from "./infra/term.ts";
import { render } from "./render.ts";

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

const notImplemented = (name: string) =>
  defineCommand({
    meta: { name, description: `hop ${name} (not implemented yet)` },
    async run() {
      process.stderr.write(`hop ${name}: not implemented yet\n`);
      process.exitCode = 1;
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
  async run({ args }) {
    const shell = String(args.shell);
    if (shell !== "zsh") {
      process.stderr.write(`Unsupported shell: ${shell}\n`);
      process.exitCode = 2;
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
    ...(options.track !== undefined ? { track: options.track } : {}),
  });
  render("jump", result, options.json);
  applyExitCode(result);
};

const RESERVED_COMMANDS = {
  ls: lsCommand,
  rm: rmCommand,
  clean: notImplemented("clean"),
  root: notImplemented("root"),
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

const runJumpFromArgs = async (rawArgs: readonly string[]): Promise<void> => {
  const args = parseArgs([...rawArgs], jumpArgsSchema);
  if (args.target === undefined) {
    // No picker yet (PR2): non-interactive fallback lists worktrees.
    const result = await ls(git, fs, { cwd: process.cwd() });
    render("ls", result, Boolean(args.json));
    applyExitCode(result);
    return;
  }
  await runJump(String(args.target), {
    create: Boolean(args.create),
    json: Boolean(args.json),
    ...(args.track !== undefined ? { track: String(args.track) } : {}),
  });
};

// Dispatch is manual (not citty's `subCommands`) because citty's runCommand
// always invokes a parent's `run` even after dispatching a subcommand, and
// throws on any unrecognized first token — both wrong for us, since any
// non-reserved first token must fall through to `jump` as a branch name.
const rawArgs = process.argv.slice(2);

if (rawArgs[0] === "--") {
  // `hop -- <branch>` escapes reserved words (ls/rm/clean/root/init) so they
  // can be used as branch names.
  await runJumpFromArgs(rawArgs.slice(1));
} else if (rawArgs[0] !== undefined && rawArgs[0] in RESERVED_COMMANDS) {
  const [name, ...rest] = rawArgs;
  const command = RESERVED_COMMANDS[name as keyof typeof RESERVED_COMMANDS];
  // biome-ignore lint/suspicious/noExplicitAny: runCommand's generic can't unify this heterogeneous command union.
  await runCommand(command as any, { rawArgs: rest });
} else {
  await runJumpFromArgs(rawArgs);
}

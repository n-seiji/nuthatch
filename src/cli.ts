#!/usr/bin/env node
import { type ArgsSpec, parseCliArgs } from "./cli-args.ts";
import {
  dispatchCliArgs,
  isHelpRequest,
  isRunningAsCompiledBinary,
  isUpdateRequest,
  isVersionRequest,
  normalizeCliArgs,
} from "./cli-dispatch.ts";
import { reportFatalError, wantsJson } from "./cli-fatal.ts";
import { describeFatalError } from "./domain/fatal-error.ts";
import type { FsPort, GitPort, TermPort } from "./domain/ports.ts";
import { EXIT_CANCELLED, EXIT_SUCCESS, EXIT_USAGE_ERROR, ok } from "./domain/result.ts";
import { createFsPort } from "./infra/fs.ts";
import { createGitPort } from "./infra/git.ts";
import { createTermPort } from "./infra/term.ts";
import { render, reportResult } from "./render.ts";
import { USAGE } from "./usage.ts";
import { VERSION } from "./version.ts";

/*
 * Every command's implementation is loaded with a dynamic import, on the path
 * that runs it: one invocation runs one command, so `hop <branch>` never pays
 * to evaluate the picker UI, `hop --version` never loads git plumbing, and
 * only `hop --update` reaches the network and crypto code.
 */

interface Ports {
  readonly git: GitPort;
  readonly fs: FsPort;
  readonly term: TermPort;
}

let ports: Ports | null = null;
const getPorts = (): Ports => {
  ports ??= { git: createGitPort(), fs: createFsPort(), term: createTermPort() };
  return ports;
};

const JSON_FLAG = "json";

const runLs = async (json: boolean): Promise<void> => {
  const [{ ls }, { reportLs }] = await Promise.all([
    import("./commands/ls.ts"),
    import("./render-ls.ts"),
  ]);
  const { git, fs } = getPorts();
  reportLs(await ls(git, fs, { cwd: process.cwd() }), json);
};

const runJump = async (
  target: string,
  options: { create: boolean; track?: string; json: boolean },
): Promise<void> => {
  const { jump } = await import("./commands/jump.ts");
  const { git, fs } = getPorts();
  const result = await jump(git, fs, {
    cwd: process.cwd(),
    target,
    create: options.create,
    ...(options.track === undefined ? {} : { track: options.track }),
  });
  reportResult("jump", result, options.json);
};

/**
 * Runs the interactive picker (TTY only; ui/picker.ts's own terminal-session
 * checks stdin/stderr isTTY-ness and skips raw mode when not interactive).
 * Mutation wiring (delete / switch root here) lives in cli-pick.ts — see its
 * module comment for why.
 */
const runInteractivePick = async (json: boolean): Promise<void> => {
  const {
    createPickerCallbacks,
    loadPickCandidates,
    renderSwitchRootOutcome,
    runInteractivePicker,
  } = await import("./cli-pick.ts");
  const { git, fs } = getPorts();
  const candidates = await loadPickCandidates(git, fs, json);
  if (candidates === null) {
    return;
  }

  let lastSwitchRootOutcome: Parameters<typeof renderSwitchRootOutcome>[1] = null;
  const callbacks = createPickerCallbacks(git, fs, json, (outcome) => {
    lastSwitchRootOutcome = outcome;
  });

  const outcome = await runInteractivePicker(candidates, callbacks);
  if (outcome.type === "cancelled") {
    // Esc: a quiet "never mind" — exit 0, stdout stays empty so the shell
    // Wrapper just doesn't cd. Ctrl+C: reads as a real interrupt, same exit
    // Code (130) as an actual SIGINT.
    process.exitCode = outcome.reason === "esc" ? EXIT_SUCCESS : EXIT_CANCELLED;
    return;
  }

  if (outcome.type === "path") {
    renderSwitchRootOutcome(outcome.path, lastSwitchRootOutcome, json);
    return;
  }

  const selected = outcome.candidate;
  if (selected.kind === "worktree") {
    const result = ok({
      path: selected.worktree.path,
      data: { branch: selected.worktree.branch, created: false },
    });
    render("pick", result, json);
    return;
  }

  await runJump(selected.branch, { create: true, json });
};

const JUMP_ARGS: ArgsSpec = {
  positionals: [{ name: "target", required: false }],
  booleans: ["create", JSON_FLAG],
  strings: ["track"],
};

const runJumpFromArgs = async (tokens: readonly string[]): Promise<void> => {
  const args = parseCliArgs(tokens, JUMP_ARGS);
  const json = args.booleans.json ?? false;
  const { target } = args.positionals;
  if (target === undefined) {
    if (getPorts().term.isTTY()) {
      await runInteractivePick(json);
      return;
    }
    // Non-TTY: no picker, just list worktrees.
    await runLs(json);
    return;
  }
  const { track } = args.strings;
  await runJump(target, {
    create: args.booleans.create ?? false,
    json,
    ...(track === undefined ? {} : { track }),
  });
};

const runRm = async (tokens: readonly string[]): Promise<void> => {
  const args = parseCliArgs(tokens, {
    positionals: [{ name: "branch", required: true }],
    booleans: ["force", "ext", JSON_FLAG],
  });
  const { rm } = await import("./commands/rm.ts");
  const { git, fs } = getPorts();
  const result = await rm(git, fs, {
    cwd: process.cwd(),
    branch: args.positionals.branch ?? "",
    force: args.booleans.force ?? false,
    ext: args.booleans.ext ?? false,
  });
  reportResult("rm", result, args.booleans.json ?? false);
};

const runClean = async (tokens: readonly string[]): Promise<void> => {
  const args = parseCliArgs(tokens, {
    booleans: ["ext", "withBranch", "dryRun", "yes", JSON_FLAG],
  });
  const { clean } = await import("./commands/clean.ts");
  const { git, fs, term } = getPorts();
  const result = await clean(git, fs, term, {
    cwd: process.cwd(),
    ext: args.booleans.ext ?? false,
    withBranch: args.booleans.withBranch ?? false,
    dryRun: args.booleans.dryRun ?? false,
    yes: args.booleans.yes ?? false,
  });
  reportResult("clean", result, args.booleans.json ?? false);
};

const runRoot = async (tokens: readonly string[]): Promise<void> => {
  const args = parseCliArgs(tokens, {
    positionals: [{ name: "branch", required: false }],
    booleans: [JSON_FLAG],
    strings: ["track"],
  });
  const { root } = await import("./commands/root.ts");
  const { git, fs } = getPorts();
  const { branch } = args.positionals;
  const { track } = args.strings;
  const result = await root(git, fs, {
    cwd: process.cwd(),
    ...(branch === undefined ? {} : { target: branch }),
    ...(track === undefined ? {} : { track }),
  });
  reportResult("root", result, args.booleans.json ?? false);
};

const runInit = async (tokens: readonly string[]): Promise<void> => {
  const args = parseCliArgs(tokens, {
    positionals: [{ name: "shell", required: true }],
  });
  const shell = args.positionals.shell ?? "";
  if (shell !== "zsh") {
    process.stderr.write(`Unsupported shell: ${shell}\n`);
    process.exitCode = EXIT_USAGE_ERROR;
    return;
  }
  const { renderInit } = await import("./commands/init.ts");
  process.stdout.write(renderInit());
};

const RESERVED_COMMANDS: Readonly<Record<string, (tokens: readonly string[]) => Promise<void>>> = {
  ls: (tokens) => runLs(parseCliArgs(tokens, { booleans: [JSON_FLAG] }).booleans.json ?? false),
  rm: runRm,
  clean: runClean,
  root: runRoot,
  init: runInit,
};

// Dispatch is manual, not a subcommand framework's, because any non-reserved
// First token must fall through to `jump` as a branch name.
// Process.argv is [node, script, ...userArgs]; drop the first two.
const ARGV_USER_ARGS_START = 2;

const dispatchAndRun = async (dispatch: ReturnType<typeof dispatchCliArgs>): Promise<void> => {
  const command = dispatch.kind === "reserved" ? RESERVED_COMMANDS[dispatch.name] : undefined;
  await (command === undefined ? runJumpFromArgs(dispatch.args) : command(dispatch.args));
};

const runUpdate = async (rawArgs: readonly string[]): Promise<void> => {
  const update = await import("./cli-update.ts");
  await update.runUpdate(rawArgs, getPorts().term);
};

const main = async (): Promise<void> => {
  const rawArgs = normalizeCliArgs(
    process.argv.slice(ARGV_USER_ARGS_START),
    process.argv0,
    isRunningAsCompiledBinary(),
  );

  if (isHelpRequest(rawArgs)) {
    process.stderr.write(USAGE);
    process.exitCode = 0;
    return;
  }

  // Both are flags (not reserved words), recognised only as the first token.
  if (isVersionRequest(rawArgs)) {
    process.stdout.write(`${VERSION}\n`);
    process.exitCode = EXIT_SUCCESS;
    return;
  }
  if (isUpdateRequest(rawArgs)) {
    await runUpdate(rawArgs);
    return;
  }

  const dispatch = dispatchCliArgs(rawArgs, Object.keys(RESERVED_COMMANDS));
  try {
    await dispatchAndRun(dispatch);
  } catch (error) {
    /*
     * A bare `hop` falls through to jump/ls/pick; "jump" is the closest name
     * the envelope can carry for it.
     */
    const command = dispatch.kind === "reserved" ? dispatch.name : "jump";
    reportFatalError(command, wantsJson(rawArgs), error);
  }
};

try {
  await main();
} catch (error) {
  /*
   * Backstop for a throw before dispatch, where no command name or --json
   * flag is known yet: stderr only, and stdout stays empty so the shell
   * wrapper never cd's on a crash.
   */
  const fatal = describeFatalError(error);
  process.stderr.write(`hop: ${fatal.message}\n`);
  process.exitCode = fatal.exitCode;
}

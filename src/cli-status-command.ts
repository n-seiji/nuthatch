import { defineCommand } from "citty";
import { status } from "./commands/status.ts";
import type { FsPort, GitPort } from "./domain/ports.ts";
import { reportResult } from "./render.ts";

/** `hop status [<branch>] [--json]` — one worktree in detail (see commands/status.ts). */
export const createStatusCommand = (git: GitPort, fs: FsPort) =>
  defineCommand({
    meta: { name: "status", description: "Show one worktree in detail" },
    args: {
      branch: {
        type: "positional",
        required: false,
        description: "Branch whose worktree to show (default: the one containing the cwd)",
      },
      json: { type: "boolean", description: "Output JSON" },
    },
    async run({ args }) {
      const result = await status(git, fs, {
        cwd: process.cwd(),
        ...(args.branch === undefined ? {} : { branch: String(args.branch) }),
      });
      reportResult("status", result, Boolean(args.json));
    },
  });

import { defineCommand } from "citty";
import { renderInit } from "./commands/init.ts";
import { EXIT_USAGE_ERROR } from "./domain/result.ts";

export const initCommand = defineCommand({
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

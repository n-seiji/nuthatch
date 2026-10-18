import { createInterface } from "node:readline";
import type { TermPort } from "../domain/ports.ts";

/** Whether SGR color codes should go to `stream`: it is a TTY and NO_COLOR is unset or empty (the NO_COLOR convention). */
export const colorEnabled = (stream: { readonly isTTY?: boolean }): boolean =>
  stream.isTTY === true && (process.env["NO_COLOR"] ?? "") === "";

export const createTermPort = (): TermPort => ({
  isTTY() {
    // Checks stderr (and stdin), not stdout: the shell wrapper always
    // Captures hop's stdout via command substitution (`out="$(command hop
    // "$@")"`) to get the cd target, which makes process.stdout.isTTY false
    // Even at a real interactive terminal. stderr and stdin stay attached to
    // The terminal through command substitution, so they're the correct
    // Signal here — matching where the picker actually renders (stderr) and
    // Reads input (stdin).
    return process.stderr.isTTY === true && process.stdin.isTTY === true;
  },

  logStderr(message) {
    process.stderr.write(`${message}\n`);
  },

  confirm(message) {
    return new Promise((resolve) => {
      const rl = createInterface({
        input: process.stdin,
        output: process.stderr,
        terminal: false,
      });
      rl.question(`${message} [y/N] `, (answer) => {
        rl.close();
        resolve(answer.trim().toLowerCase() === "y");
      });
      rl.once("close", () => {
        resolve(false);
      });
    });
  },
});

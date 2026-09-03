import { createInterface } from "node:readline";
import type { TermPort } from "../domain/ports.ts";

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

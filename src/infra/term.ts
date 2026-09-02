import type { TermPort } from "../domain/ports.ts";

export const createTermPort = (): TermPort => ({
  isTTY() {
    return process.stdout.isTTY === true;
  },

  logStderr(message) {
    process.stderr.write(`${message}\n`);
  },
});

import { describe, expect, it, spyOn } from "bun:test";
import { renderSwitchRootOutcome, type SwitchRootOutcome } from "./cli-pick.ts";

describe("renderSwitchRootOutcome", () => {
  it("--json: detachedHolder と warnings を envelope に含める", () => {
    const stdout = spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const outcome: SwitchRootOutcome = {
        branch: "feat/held",
        detachedHolder: "/repo/held",
        warnings: ["Put /repo/held into detached HEAD"],
      };
      renderSwitchRootOutcome("/repo", outcome, true);

      expect(stdout).toHaveBeenCalledTimes(1);
      const written = stdout.mock.calls[0]?.[0] as string;
      const envelope = JSON.parse(written) as {
        data: {
          branch: string;
          switched: boolean;
          detachedHolder: string | null;
        };
        warnings: readonly string[];
      };
      expect(envelope.data).toEqual({
        branch: "feat/held",
        switched: true,
        detachedHolder: "/repo/held",
      });
      expect(envelope.warnings).toEqual(["Put /repo/held into detached HEAD"]);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });

  it("非 --json: path を stdout に、warnings を stderr に出す", () => {
    const stdout = spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const outcome: SwitchRootOutcome = {
        branch: "feat/held",
        detachedHolder: "/repo/held",
        warnings: ["Put /repo/held into detached HEAD"],
      };
      renderSwitchRootOutcome("/repo", outcome, false);

      expect(stdout).toHaveBeenCalledWith("/repo\n");
      expect(stderr).toHaveBeenCalledWith("warning: Put /repo/held into detached HEAD\n");
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });

  it("holder を detach しなかった場合は detachedHolder が null で warnings も空", () => {
    const stdout = spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const outcome: SwitchRootOutcome = {
        branch: "main",
        detachedHolder: null,
        warnings: [],
      };
      renderSwitchRootOutcome("/repo", outcome, true);

      const written = stdout.mock.calls[0]?.[0] as string;
      const envelope = JSON.parse(written) as {
        data: { detachedHolder: string | null };
        warnings: readonly string[];
      };
      expect(envelope.data.detachedHolder).toBeNull();
      expect(envelope.warnings).toEqual([]);
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });
});

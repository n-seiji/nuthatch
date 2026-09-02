import { mkdir as mkdirFs, readdir, realpath as realpathFs } from "node:fs/promises";
import type { FsPort } from "../domain/ports.ts";

export const createFsPort = (): FsPort => ({
  async exists(path) {
    try {
      await realpathFs(path);
      return true;
    } catch {
      return false;
    }
  },

  async realpath(path) {
    return realpathFs(path);
  },

  async mkdir(path) {
    await mkdirFs(path, { recursive: true });
  },

  async listDirNames(path) {
    try {
      const entries = await readdir(path, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
  },
});

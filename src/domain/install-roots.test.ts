import { describe, expect, it } from "bun:test";
import { managerRootReason } from "./install-roots.ts";

describe("managerRootReason", () => {
  it("Homebrew の Cellar 配下の場合、Homebrew を名指しして brew upgrade を案内する", () => {
    for (const path of [
      "/opt/homebrew/Cellar/nuthatch/0.1.5/bin/hop",
      "/usr/local/Cellar/nuthatch/0.1.5/bin/hop",
      "/home/linuxbrew/.linuxbrew/Cellar/nuthatch/0.1.5/bin/hop",
    ]) {
      const reason = managerRootReason(path);

      expect(reason).toContain("Homebrew");
      expect(reason).toContain(path);
      expect(reason).toContain('"brew upgrade"');
    }
  });

  it("Nix のストア配下の場合、Nix を名指しする", () => {
    const reason = managerRootReason("/nix/store/abc123-nuthatch-0.1.5/bin/hop");

    expect(reason).toContain("Nix");
    expect(reason).toContain("read-only");
  });

  it("aqua のパッケージ配下の場合、aqua を名指しする", () => {
    for (const path of [
      "/home/u/.local/share/aquaproj-aqua/pkgs/github_release/github.com/n-seiji/nuthatch/v0.1.5/hop",
      "/home/u/aqua/pkgs/github_release/github.com/n-seiji/nuthatch/v0.1.5/hop",
    ]) {
      expect(managerRootReason(path)).toContain("aqua");
    }
  });

  it("proto のツール配下の場合、proto を名指しする", () => {
    expect(managerRootReason("/home/u/.proto/tools/hop/0.1.5/hop")).toContain("proto");
  });

  it("どの管理ツールの配下でもないパスの場合、null を返す", () => {
    for (const path of [
      "/home/u/.local/bin/hop",
      "/usr/local/bin/hop",
      "/home/u/Cellars/hop",
      "/home/u/nix/store-notes/hop",
      "/home/u/.local/share/mise/installs/hop/0.1.5/hop",
    ]) {
      expect(managerRootReason(path)).toBeNull();
    }
  });
});

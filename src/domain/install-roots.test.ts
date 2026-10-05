import { describe, expect, it } from "bun:test";
import { managerNpmPrefixReason, managerRootReason } from "./install-roots.ts";

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

  it("Homebrew の Caskroom (cask) 配下の場合も、Homebrew を名指しして brew upgrade を案内する", () => {
    for (const path of [
      "/opt/homebrew/Caskroom/nuthatch/0.1.5/hop",
      "/usr/local/Caskroom/nuthatch/0.1.5/hop",
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

describe("managerNpmPrefixReason", () => {
  it("Homebrew の formula が std_npm_args で入れた keg の libexec の場合、Homebrew を名指しして brew upgrade を案内する", () => {
    for (const prefix of [
      "/opt/homebrew/Cellar/nuthatch/0.1.5/libexec",
      "/usr/local/Cellar/nuthatch/0.1.5/libexec",
      "/home/linuxbrew/.linuxbrew/Cellar/nuthatch/0.1.5/libexec",
      "/opt/homebrew/Caskroom/nuthatch/0.1.5/libexec",
    ]) {
      const reason = managerNpmPrefixReason(prefix);

      expect(reason).toContain("Homebrew");
      expect(reason).toContain(prefix);
      expect(reason).toContain('"brew upgrade"');
    }
  });

  it("Nix のストア配下の場合、Nix を名指しする", () => {
    const reason = managerNpmPrefixReason("/nix/store/abc123-nuthatch-0.1.5");

    expect(reason).toContain("Nix");
    expect(reason).toContain("read-only");
  });

  it("利用者が npm i -g で入れた通常の prefix の場合、null を返す (Homebrew の共有 prefix も含む)", () => {
    for (const prefix of [
      "/opt/homebrew",
      "/usr/local",
      "/home/u/.npm-global",
      "/home/u/.nvm/versions/node/v22.0.0",
      "/home/u/.local/share/mise/installs/node/25.6.1",
      "/home/u/Cellars/node",
    ]) {
      expect(managerNpmPrefixReason(prefix)).toBeNull();
    }
  });

  it("aqua / proto が管理する node の prefix は、npm i -g の置き場として使われるだけなので null を返す", () => {
    for (const prefix of [
      "/home/u/.proto/tools/node/22.0.0",
      "/home/u/.local/share/aquaproj-aqua/pkgs/github_release/nodejs/22.0.0",
    ]) {
      expect(managerNpmPrefixReason(prefix)).toBeNull();
    }
  });
});

import { describe, expect, it } from "bun:test";
import { classifyWorktreePath } from "./classify.ts";

describe("classifyWorktreePath", () => {
  const root = "/home/user/ghq/github.com/user/repo";
  const managedRoot = "/home/user/ghq/github.com/user/_worktree/repo";

  it("root clone の path は root と分類する", () => {
    expect(classifyWorktreePath(root, root, managedRoot)).toBe("root");
  });

  it("managed root 配下の path は managed と分類する", () => {
    const path = `${managedRoot}/feat__foo`;
    expect(classifyWorktreePath(path, root, managedRoot)).toBe("managed");
  });

  it("managed root 外の path は external と分類する", () => {
    const path = "/home/user/somewhere-else/wt";
    expect(classifyWorktreePath(path, root, managedRoot)).toBe("external");
  });

  it("文字列 prefix が一致するだけの兄弟ディレクトリは external と分類する", () => {
    // "/…/_worktree/repo-other" starts with the managedRoot string as a prefix,
    // But is not actually inside it — must not be misclassified as managed.
    const sibling = `${managedRoot}-other/branch`;
    expect(classifyWorktreePath(sibling, root, managedRoot)).toBe("external");
  });

  it("managed root 自体は managed と分類する", () => {
    expect(classifyWorktreePath(managedRoot, root, managedRoot)).toBe("managed");
  });
});

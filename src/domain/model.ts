// Worktree and WorktreeKind are defined as valibot schemas in ./schema.ts,
// Which is the single source of truth for nuthatch's JSON output contract.
// Re-exported here so existing "./model.ts" imports keep working.
export type { Worktree, WorktreeKind } from "./schema.ts";

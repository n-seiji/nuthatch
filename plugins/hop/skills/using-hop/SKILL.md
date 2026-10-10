---
name: using-hop
description: Use when a coding agent needs to create, select, inspect, remove, or temporarily switch git worktrees with the hop CLI.
---

# Using hop from a coding agent

`hop` maps one branch to one worktree under
`<root-parent>/_worktree/<repo>/<branch>`. Treat the root clone as a
verification checkout; make code changes in a worktree.

## Start work

Use a unique branch and capture the returned absolute path:

```bash
worktree_path=$(hop feat/my-task --create)
git -C "$worktree_path" status --short
```

Coding agents cannot rely on a shell's `cd` persisting between calls. Use the
returned path as the command working directory or with `git -C` for the rest
of the task.

## Choose a command

- Create or select a branch worktree: `hop <branch> --create`
- Inspect worktrees without a picker: `hop ls --json`
- Inspect one worktree (changes, last commit, upstream, whether `hop clean`
  would remove it): `hop status [<branch>] --json` — without a branch, the
  worktree you are in
- Resolve the root clone: `hop root`
- Escape a reserved branch name: `hop -- <branch>`
- Check current flags and output details: `hop --help`

When the `hop` MCP server is connected, its `list_worktrees`,
`worktree_status` and `clean_candidates` tools return the same JSON as
`hop ls`, `hop status` and `hop clean --dry-run`. They only read; create,
remove and switch with the CLI.

Before using `hop rm`, `hop clean`, or `hop root <branch>`, read
[references/destructive-operations.md](references/destructive-operations.md).

## Safety invariants

- Do not edit in the root clone.
- Give each agent a unique branch; never share a branch between agents.
- Remove or clean up only worktrees you created for the current task.
- Resolve dirty state deliberately. Do not reach for `--force` as a shortcut.
- After a temporary root switch, restore it with `hop root -`.
- Treat stdout as machine output (path or JSON); diagnostics go to stderr.

---
name: using-hop
description: Use the git worktree manager "hop" (nuthatch) from a coding agent. Drives non-interactive move, create, delete, and list operations for the per-branch worktree, and keeps the root clone protected.
---

# using-hop — using hop from a coding agent

`hop` is a git worktree manager. It follows **1 branch = 1 worktree**,
placing worktrees at `<parent of the root clone>/_worktree/<repo>/<branch>`.
The root clone (the main checkout) is for verification only — code changes
happen in a worktree.

## Basic agent flow

A coding agent can't hold onto a shell's `cd`, so it takes the path and
works via `git -C`.

```bash
path=$(hop feat/my-task --create)   # create-or-jump: returns the path if it exists, otherwise creates it and returns the path
git -C "$path" status --short
# … edit, test, commit, push …
hop rm feat/my-task                 # clean up only the worktree you created
```

## Command reference (non-interactive)

| Command | Behavior |
|---|---|
| `hop <branch> --create` | Returns the path if the worktree exists. Otherwise creates it from the default branch and returns the path. Without `--create`, a missing worktree is a safety rejection (exit 3) |
| `hop root` | The root clone's path |
| `hop ls --json` | A JSON listing of every worktree (`{schemaVersion, command, data, warnings}`), including kind (root/managed/external), dirty, and ahead/behind |
| `hop rm <branch>` | Removes the worktree (the branch is kept). Doesn't distinguish managed from external. Refuses if dirty (`--force` to override). Always refuses a worktree git reports as locked, even with `--force`. If multiple worktrees hold the branch, refuses rather than guessing which path to remove (`--ext` is a deprecated no-op that only prints a warning) |
| `hop clean --dry-run` | Returns garbage worktree candidates (prunable / merged / gone) as JSON. Targets managed worktrees only (`--ext` includes external too). `--yes` executes the deletion. `--with-branch` deletes the branch only for branches confirmed merged/gone (unconfirmed branches are kept) |
| `hop root <branch>` / `hop root -` | Temporarily switches the root clone / returns it (for verification). Even if the target branch is already checked out on another worktree (the "holder"), it's automatically swapped out — detached to HEAD — as long as it's clean and not git-locked; refuses if the holder is dirty/locked. `hop root -` restores only root's branch; a swapped holder stays detached |
| `hop -- <branch>` | Escapes a branch name that collides with a reserved word (ls/rm/clean/root/init) |

- stdout: only a path or JSON. Logs go to stderr.
- exit code: 0=success (including a picker ESC cancel) / 1=generic error /
  2=usage error / 3=safety rejection (e.g. dirty) / 130=SIGINT interruption
- `hop --help` prints full command/flag usage to stderr (exit 0)

## Operating rules

1. **Never edit in the root clone.** Do editing and testing in a worktree.
2. Don't rely on the viewer/picker — always pass the branch explicitly as
   an argument.
3. `hop rm` can also delete an external worktree (kind=external, created by
   another agent), but since it might belong to another agent or human's
   active session, only `rm`/`clean` worktrees you created yourself. Only
   clean up what you made.
4. Don't share the same branch across multiple agents. Use a unique branch
   name.
5. If you hit a dirty rejection (exit 3), commit or stash first. Don't reach
   for `--force` casually.
6. If you use a temporary root switch (`hop root <branch>`), always switch
   it back with `hop root -` afterward. Even if the target branch is
   already checked out on another worktree, hop will auto-detach and swap
   it — which means it can free up another agent's working branch. This is
   generally not a problem as long as you use your own unique branch name.

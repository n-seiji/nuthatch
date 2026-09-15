# Destructive and root-switch operations

Read this before removing worktrees, cleaning candidates, or switching the
root clone to another branch.

## Remove one worktree

`hop rm <branch>` removes the worktree and keeps the branch. It can target
managed or external worktrees, so confirm the target with `hop ls --json` and
operate only on a worktree you created for the current task.

- Dirty worktrees are refused unless `--force` is supplied. Resolve the dirty
  files instead of forcing removal.
- Git-locked worktrees are always refused, even with `--force`; hop never
  removes the lock.
- If multiple worktrees hold the same branch, hop refuses rather than guessing
  which path to remove.

## Clean candidates

Start with `hop clean --dry-run --json`. Automatic candidates are managed
worktrees that are prunable, merged, or gone. External worktrees are excluded
unless `--ext` is explicitly supplied.

`--yes` performs deletion. `--with-branch` also removes only branches confirmed
merged or gone; branches whose state cannot be confirmed are kept.

## Temporarily switch the root clone

`hop root <branch>` switches the root clone for verification. If another
worktree already holds the branch, hop may detach that clean, unlocked holder
at its current HEAD. It refuses a dirty or locked holder.

Use only your own unique branch, and always finish with `hop root -`. The
restore operation restores the root clone's previous branch; a holder detached
during the switch remains detached.

## Exit behavior

- `0`: success
- `1`: general failure
- `2`: usage error
- `3`: safety rejection, such as dirty state
- `130`: interruption

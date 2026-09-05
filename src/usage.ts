// Usage text is printed to stderr and the process exits 0 — stdout stays reserved for path/JSON output per the CLI's cd contract.
export const USAGE = `Usage: hop [command] [options]

  hop                    Pick a worktree/branch interactively and cd into it (TTY); lists worktrees otherwise
  hop <branch>           Create-or-jump: cd into <branch>'s worktree, creating it on demand
  hop root               cd into the root clone
  hop -                  cd back to the previous worktree
  hop -- <branch>        Escape a branch name that collides with a reserved command (ls/rm/clean/root/init/help)

  hop ls [--json]        List worktrees (dirty, ahead/behind, kind)
  hop rm <branch>        Remove a worktree, keeping the branch
  hop clean              Auto-detect and remove garbage worktrees
  hop root <branch>      Temporarily switch the root clone (for verification)
  hop root -             Switch the root clone back
  hop init zsh           Print the zsh shell integration (eval "$(hop init zsh)")

Interactive picker keys:
  Enter                  cd into the selected candidate
  Tab                    Open the action panel (cd / delete / switch root here)
  Ctrl+X                 Delete the selected worktree (y/N confirmation)
  Ctrl+R                 Switch the root clone to the selected branch, immediately
  ↑/↓, Ctrl+P/N, Ctrl+K/J Move the selection (arrow, emacs, and vim keys all work)
  Esc                    Cancel (exit 0, no output)
  Ctrl+C                 Cancel like an interrupt (exit 130, same as SIGINT)
  In the action panel: same movement keys, Enter to run the highlighted action,
  c/d/r to run cd/delete/switchRoot directly, Esc/Tab to close

Options:
  --create               Create the worktree when jumping to a branch without one (required outside a TTY)
  --json                 Output JSON instead of plain text
  --force                Force removal even if the worktree is dirty (hop rm)
  --ext                  Allow operating on external worktrees (hop rm / hop clean)
  --yes                  Skip confirmation and execute (hop clean)
  --dry-run              Only report candidates as JSON, without deleting (hop clean)
  --with-branch          Also delete the branch when cleaning (hop clean)
  -h, --help             Show this help and exit
`;

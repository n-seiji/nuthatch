// Usage text is printed to stderr and the process exits 0 — stdout stays reserved for path/JSON output per the CLI's cd contract.
export const USAGE = `Usage: hop [command] [options]

  hop                    Pick a worktree/branch interactively and cd into it (TTY); lists worktrees otherwise
  hop <branch>           Create-or-jump: cd into <branch>'s worktree (pass --create to create a missing one)
  hop root               cd into the root clone
  hop -                  cd back to the previous worktree
  hop -- <branch>        Escape a branch name that collides with a reserved command (ls/rm/status/clean/root/init/mcp/help)

  hop ls [--json]        List worktrees (dirty, ahead/behind, kind)
  hop rm <branch>        Remove a worktree, keeping the branch
  hop status [<branch>]  Show one worktree in detail: changes, last commit, upstream (default: the cwd's)
  hop clean              Auto-detect and remove garbage worktrees
  hop root <branch>      Temporarily switch the root clone (for verification)
  hop root -             Switch the root clone back
  hop init zsh           Print the zsh shell integration (eval "$(hop init zsh)")

  hop mcp                Serve read-only worktree tools over MCP (stdio), for AI clients
  hop mcp install <client>  Register hop's MCP server with claude or codex (--dry-run: only print)
  hop mcp config         Print the mcpServers entry for clients configured by a JSON file

  hop --update           Update hop to the latest release, the way it was installed
  hop --update --check   Only report whether an update is available; change nothing
  hop --version          Print hop's version

Interactive picker keys:
  Enter                  cd into the selected candidate
  Tab, →, Ctrl+L, Ctrl+F Open the action panel, as a column beside the list
                         (stacks below it instead on narrow terminals)
  Ctrl+X                 Delete the selected worktree (y/N confirmation)
  Ctrl+R                 Switch the root clone to the selected branch (y/N first for an external worktree)
  ↑/↓, Ctrl+P/N, Ctrl+K/J Move the selection (arrow, emacs, and vim keys all work)
  Esc                    Cancel (exit 0, no output)
  Ctrl+C                 Cancel like an interrupt (exit 130, same as SIGINT)
  In the action panel: same up/down movement keys, Enter to run the highlighted
  action, c/d/r to run cd/delete/switchRoot directly, Esc/Tab/←/Ctrl+H to close

Options:
  --create               Create the worktree when jumping to a branch without one (always required, TTY or not)
  --json                 Output JSON instead of plain text
  --force                Force removal even if the worktree is dirty (hop rm)
  --ext                  [deprecated, no-op for hop rm] hop rm no longer requires it to
                         remove external worktrees; still gates hop clean's auto-cleanup scope
  --yes                  Skip confirmation and execute (hop clean)
  --dry-run              Only report candidates as JSON, without deleting (hop clean);
                         only print the client command (hop mcp install)
  --with-branch          Also delete the branch when cleaning (hop clean)
  -h, --help             Show this help and exit
`;

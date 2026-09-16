# hop plugin

A plugin that distributes the usage skill for the git worktree manager "hop"
(nuthatch). Installable from both Claude Code and Codex.

- `skills/using-hop/SKILL.md` — common non-interactive workflow and invariants
- `skills/using-hop/references/destructive-operations.md` — safety guidance loaded only for remove, clean, and root-switch operations

## Install

```
# Claude Code
/plugin marketplace add n-seiji/nuthatch
/plugin install hop@nuthatch

# Codex
codex plugin marketplace add n-seiji/nuthatch
codex plugin install hop
```

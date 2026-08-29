# nuthatch 🐦

> Hop between git worktrees like a nuthatch hops between trees.

`nuthatch` is a zero-setup git worktree manager. Its single command, **`hop`**,
jumps you to the worktree of any branch — creating it on the fly when it
doesn't exist yet. Built for humans (interactive picker) and AI coding agents
(non-interactive, `--json`) alike.

## Why

- **Zero setup** — no state files, no init. `git worktree list --porcelain` is
  the single source of truth. Works in any repository immediately.
- **Convention over config** — worktrees always live at
  `<parent-of-root>/_worktree/<repo>/<branch>`, so listing and path inference
  are fast and predictable.
- **AI native** — every command completes non-interactively, `--json`
  everywhere, paths on stdout / logs on stderr, and errors that tell you the
  next step.

## Usage

```sh
hop                # pick a worktree/branch interactively and cd into it
hop feat/foo       # cd into feat/foo's worktree — created on demand
hop root           # cd into the root clone
hop -              # cd back to the previous worktree

hop ls [--json]    # list worktrees (dirty, ahead/behind, kind)
hop rm <branch>    # remove a worktree (branch is kept)
hop clean          # auto-detect and remove garbage worktrees
hop root <branch>  # temporarily switch the root clone (for verification)
hop root -         # switch the root clone back
```

Shell integration (auto-`cd`):

```sh
# ~/.zshrc
eval "$(hop init zsh)"
```

## Install

> Not released yet. Planned:

```sh
npm i -g @n-seiji/nuthatch        # or: bunx @n-seiji/nuthatch
mise use -g npm:@n-seiji/nuthatch # mise
curl -fsSL https://raw.githubusercontent.com/n-seiji/nuthatch/main/install.sh | sh  # binary
```

## Docs

- [docs/design.md](docs/design.md) — full design document (Japanese)
- [AGENTS.md](AGENTS.md) — guide for coding agents working on this repo

## License

MIT

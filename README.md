<p align="center">
  <img src="docs/assets/logo.png" alt="nuthatch — hop between git worktrees" width="560">
</p>

<p align="center"><em>Hop between git worktrees like a nuthatch hops between trees.</em></p>

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

> Not released yet — no version has been published or tagged. Once the first
> `v*` tag ships, the options below will work as described.

```sh
npm i -g @n-seiji/nuthatch        # or: bunx @n-seiji/nuthatch
mise use -g npm:@n-seiji/nuthatch # mise

# Prebuilt binary (macOS arm64/x64, Linux x64) — no Node.js required:
curl -fsSL https://raw.githubusercontent.com/n-seiji/nuthatch/main/install.sh | sh
```

The install script places `hop` in `~/.local/bin` (override with
`HOP_INSTALL_DIR`) and always fetches the latest GitHub Release; pin a
specific version with `HOP_VERSION=vX.Y.Z`. Linux arm64 has no prebuilt
binary yet — use the npm install instead.

## Agent skill (Claude Code / Codex plugin)

This repo doubles as a plugin marketplace that ships the
[`using-hop`](skills/using-hop/SKILL.md) skill — it teaches coding agents how
to drive `hop` non-interactively and safely.

```sh
# Claude Code
/plugin marketplace add n-seiji/nuthatch
/plugin install hop@nuthatch

# Codex
codex plugin marketplace add n-seiji/nuthatch
codex plugin install hop
```

## Docs

- [docs/design.md](docs/design.md) — full design document (Japanese)
- [AGENTS.md](AGENTS.md) — guide for coding agents working on this repo

## License

MIT

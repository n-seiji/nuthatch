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

hop -- <branch>    # escape a branch name that collides with a reserved command
hop --help         # print usage (also -h / hop help)
```

### Interactive picker

The picker groups candidates into sections — existing worktrees (root first)
and not-yet-created branches — with a status marker, aligned columns, and
shortened paths:

```
  WORKTREES
❯ ● main          root     ~/ghq/.../nuthatch
  ○ feat/picker   managed  …/_worktree/feat__picker
  ● codex/fix-x   ext      …/.claude/worktrees/x

  BRANCHES — Enter で worktree 作成
  + feat/idea     local
  + origin/hotfix remote

  (●=dirty ○=clean +=未作成)
```

A section (header included) disappears entirely when it has no candidates —
including when a search query filters it down to zero.

Ordering within each section is fixed, not insertion order: WORKTREES puts
root first, then managed worktrees, then external ones (branch name
ascending within each group, detached-HEAD worktrees last within theirs);
BRANCHES puts local branches before remote ones (branch name ascending
within each group). This holds under search filtering too — narrowing the
list never reshuffles what's left. BRANCHES rows render dim so "already a
worktree" vs. "not created yet" reads at a glance, on top of the ○/●/+
markers.

The picker runs in the terminal's alternate screen buffer (the same
mechanism fzf and vim use), so it never gets pushed into your scrollback
history — each run paints over itself and cleanly restores your shell's
screen on exit, however it exits (selection, Esc/Ctrl-C, or an interrupt).

### Interactive picker keys

The action panel renders as a column beside the candidate list (not an
overlay), so the list stays visible while you pick an action. On terminals
narrower than 60 columns it falls back to stacking below the list instead,
since the two can't fit side by side.

| Key | Action |
|---|---|
| `Enter` | cd into the selected candidate |
| `Tab`, `→`, `Ctrl+L` | Open the action panel for the selected candidate (cd / delete / switch root here) |
| `Ctrl+X` | Delete the selected worktree (asks y/N first) |
| `Ctrl+R` | Switch the root clone to the selected branch, immediately |
| `↑`/`↓`, `Ctrl+P`/`Ctrl+N`, `Ctrl+K`/`Ctrl+J` | Move the selection (arrow, emacs, and vim keys all work side by side) |
| `Esc` | Cancel quietly — exit 0, stdout stays empty (the shell wrapper just doesn't cd) |
| `Ctrl+C` | Cancel like an interrupt — exit 130, same as a real SIGINT |

Inside the action panel: the same up/down movement keys (left/right are
reserved for closing, so they never double as movement), `Enter` to run the
highlighted action, `c`/`d`/`r` to run cd/delete/switch-root directly, and
`Esc`, `Tab`, `←`, or `Ctrl+H` to close it back to the list (`←`/`Ctrl+H`
mirror the `→`/`Ctrl+L` that open it; `Tab` toggles either way — handy on
terminals like Ghostty that remap a chord such as Cmd+K to Tab). `delete`
only appears for a worktree nuthatch manages (`managed`); `switch root
here` doesn't appear on the root worktree itself. Deleting reloads the
candidate list so you can keep deleting without leaving the picker; cd and
switch-root exit and print the resulting path, per hop's stdout contract.

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

GPL-3.0 — see [LICENSE](LICENSE).

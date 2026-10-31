# hop guide

**English** · [日本語](guide.ja.md) · [Back to the README](../README.md)

The full reference for `hop`. For the short version, see the [README](../README.md).
The CLI contract is defined in [design.md](design.md).

*Hop between git worktrees like a nuthatch hops between trees.*

## Design principles

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
hop feat/foo       # cd into feat/foo's worktree (add --create to create it if missing)
hop root           # cd into the root clone
hop -              # cd back to the previous worktree

hop ls [--json]    # list worktrees (dirty, ahead/behind, kind)
hop rm <branch>    # remove a worktree (branch is kept) — managed or external, dirty needs --force
hop clean          # auto-detect and remove garbage worktrees (managed only)
hop root <branch>  # temporarily switch the root clone (for verification) —
                   # swaps out a clean, unlocked holder if the branch is checked out elsewhere
hop root -         # switch the root clone back (only root's branch; a swapped-out holder stays detached)

hop -- <branch>    # escape a branch name that collides with a reserved command
                   # (also required for a branch named the same as your `hop` binary/alias, e.g. `hop -- hop`)
hop --help         # print usage (also -h / hop help)

hop --version          # print hop's version
hop --update           # replace a standalone binary with the latest release (other installs: prints how to update)
hop --update --check   # only report whether an update is available — changes nothing
```

If Git reports the same branch checked out in multiple worktrees, the
branch-only `hop rm` command refuses rather than guessing which path to
remove. The interactive picker keeps the selected path through the final
lock-protected safety check.

### Interactive picker

The picker groups candidates into sections — existing worktrees (root first)
and not-yet-created branches — with a status marker, aligned columns, and
shortened paths:

```
  WORKTREES
❯ ● main          root     ~/ghq/.../nuthatch
  ○ feat/picker   managed  …/_worktree/feat__picker
  ● codex/fix-x   ext      …/.claude/worktrees/x

  BRANCHES — Enter creates a worktree
  + feat/idea     local
  + origin/hotfix remote

  (●=dirty ○=clean +=not created)
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
too narrow to fit both (under about 94 columns) it falls back to stacking
below the list instead.

| Key | Action |
|---|---|
| `Enter` | cd into the selected candidate |
| `Tab`, `→`, `Ctrl+L`, `Ctrl+F` | Open the action panel for the selected candidate (cd / delete / switch root here) |
| `Ctrl+X` | Delete the selected worktree (always asks y/N first) |
| `Ctrl+R` | Switch the root clone to the selected branch (asks y/N first for an `external` worktree) |
| `↑`/`↓`, `Ctrl+P`/`Ctrl+N`, `Ctrl+K` | Move the selection (arrow, emacs, and vim keys all work side by side) |
| `Esc` | Cancel quietly — exit 0, stdout stays empty (the shell wrapper just doesn't cd) |
| `Ctrl+C` | Cancel like an interrupt — exit 130, same as a real SIGINT |

Inside the action panel: the same up/down movement keys (left/right are
reserved for closing, so they never double as movement), `Enter` to run the
highlighted action, `c`/`d`/`r` to run cd/delete/switch-root directly, and
`Esc`, `Tab`, `←`, or `Ctrl+H` to close it back to the list (`←`/`Ctrl+H`
mirror the `→`/`Ctrl+L`/`Ctrl+F` that open it; `Tab` toggles either way —
handy on terminals like Ghostty that remap a chord such as Cmd+K to Tab). `delete`
appears for any already-created worktree (`managed` or `external` — from the
panel, deleting an `external` worktree, or a prunable one (git can no longer
find its working tree), asks y/N first; Ctrl+X always asks); `switch
root here` doesn't appear on the root worktree itself, and also asks y/N
first for an `external` worktree, since it can detach that worktree's HEAD.
Deleting reloads the
candidate list so you can keep deleting without leaving the picker; cd and
switch-root exit and print the resulting path, per hop's stdout contract.

Shell integration (auto-`cd`):

```sh
# ~/.zshrc
eval "$(hop init zsh)"
```

## Install

Recommended: the GitHub Release binary (built with bun; via mise,
`mise use github:n-seiji/nuthatch`). The npm version runs on Node, so its git
calls are slower (hop ls ~400ms vs ~60ms) — prefer the binary for CI or
frequent invocations.

```sh
# Prebuilt binary (macOS arm64/x64, Linux x64) — no Node.js required, fastest:
curl -fsSL https://raw.githubusercontent.com/n-seiji/nuthatch/main/install.sh | sh
mise use github:n-seiji/nuthatch # mise, via the GitHub Release binary

# npm (slower: shells out to git via Node — hop ls ~400ms vs ~60ms for the binary)
npm i -g @n-seiji/nuthatch        # or: bunx @n-seiji/nuthatch
mise use -g npm:@n-seiji/nuthatch # mise, via npm
```

The install script places `hop` in `~/.local/bin` (override with
`HOP_INSTALL_DIR`) and always fetches the latest GitHub Release; pin a
specific version with `HOP_VERSION=vX.Y.Z`. Linux arm64 has no prebuilt
binary yet — use the npm install instead.

Release binaries from releases after v0.2.0 carry a build-provenance
attestation. To verify a downloaded binary by hand:

```sh
gh attestation verify ./hop-darwin-arm64 --repo n-seiji/nuthatch \
  --signer-workflow github.com/n-seiji/nuthatch/.github/workflows/release.yml
```

When `gh` is installed and logged in, `install.sh` runs this check (pinned to
this repo's release workflow) after the SHA-256 check and aborts on failure.
Without `gh`, or without `gh auth login`, it prints a warning and installs
anyway. v0.2.0 and earlier have no attestation, so `HOP_VERSION=v0.2.0` needs
`HOP_SKIP_ATTESTATION=1`. If the check fails with an expired token, run
`gh auth status`.

### Updating

```sh
hop --update          # replace a standalone binary with the latest release
hop --update --check  # just report: current, latest, how hop was installed, what to do
hop --version         # which version do I have?
```

`hop --update` only replaces the binary that `install.sh` installs, and only if
its directory is writable (checked before the binary or its checksum is
downloaded) and its SHA-256 matches the `.sha256` attached to the release; on a
mismatch nothing is replaced (SHA-256 only; attestations are not checked). For any other install it runs nothing, makes no
request, and prints one line saying how to update it (exit 1):

| Installed with | Update with |
|---|---|
| `install.sh` (binary in `~/.local/bin`) | `hop --update`, or re-run `install.sh` |
| mise | `mise upgrade` |
| npm / bun / pnpm / yarn global | `npm i -g @n-seiji/nuthatch@latest` (or your package manager's equivalent) |
| Homebrew, Nix, aqua, proto, a source checkout, any other tool | that tool's own upgrade command |

`hop --update --check` works for every install and reports the same hint. The
only network traffic is HTTPS requests to fixed GitHub addresses, each with a
timeout and a size cap.

## Troubleshooting

`hop: git executable not found. Looked in: …` means hop could not find a git
binary. hop searches every absolute entry in `PATH`, then `/opt/homebrew/bin`,
`/usr/local/bin`, `/usr/bin` and `/bin`. If your git lives somewhere else,
point hop straight at it:

```sh
export HOP_GIT=/path/to/git
```


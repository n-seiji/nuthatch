# nuthatch design document

A git worktree manager. The command name is `hop` (the package name is
nuthatch). It replaces the old bash `wt` with its fixed slot system, rebuilt
as a stateless create-or-jump tool.

## Design principles

| Principle | Description |
|---|---|
| zero setup | No state files, no init command. `git worktree list --porcelain` is the single source of truth. Works immediately in any repository |
| convention over config | Placement is fixed by convention (ghq-style). Because the location is fixed, listing and inference are fast |
| ai-native | Every command completes non-interactively. `--json` everywhere. Paths on stdout, logs on stderr. Errors include the next step |
| fast list | One porcelain call, then fetch details (dirty / ahead-behind) only in parallel |

## Directory convention

```
~/ghq/github.com/<user>/<repo>                      # root clone (verification only)
~/ghq/github.com/<user>/_worktree/<repo>/<branch>   # worktree (one per branch)
```

- No slot numbers. **1 branch = 1 worktree = 1 dir.** No upper limit.
- The dir name is the branch name sanitized: `/` becomes `__` (not `-`,
  since that would collide `feat/foo` with `feat-foo`). On collisions with a
  case-insensitive filesystem, an overly long path, or an existing dir, a
  short hash is appended.
- Worktrees created elsewhere by Claude Code, Codex, etc. are also
  discovered via `git worktree list` and included in listing/jumping
  (treated as `external`, described below).

## Command surface — a single `hop`

There is exactly one command: `hop`. Only five names are reserved as
subcommands — `ls / rm / clean / root / init` — and a branch name that
collides with one of them is escaped with `hop -- <branch>` (uniform across
all commands). `eval "$(hop init zsh)"` defines the shell function used for
auto-`cd`.

### Navigation

| Command | Behavior |
|---|---|
| `hop` | TTY: pick a worktree/branch with the interactive picker and `cd` into it. Branches without a worktree yet (local/remote) are also offered as candidates — selecting one creates it and `cd`s in. Non-TTY: prints a listing |
| `hop <branch>` | **create-or-jump.** `cd`s into the worktree if it exists; otherwise creates it from the default branch and `cd`s in. Creation always requires `--create` (TTY or not — to prevent accidental creation from a typo); without it, `hop <branch>` refuses with a message to re-run with `--create` |
| `hop root` | `cd` into the root clone |
| `hop -` | Return to the previously visited worktree |

### Management

| Command | Behavior |
|---|---|
| `hop ls [--json]` | Listing: branch / path / category / dirty / ahead-behind. `dirty` is `false` for an entry with no working tree to inspect (bare, prunable, or git-locked with its directory missing) — check `prunable` / `locked` as well |
| `hop rm <branch>` | Removes the worktree (the branch is kept). Refuses if dirty (including untracked), overridable with `--force`. Does not distinguish managed from external. Always refuses a worktree git reports as locked, `--force` or not (`git worktree unlock` is never called). A prunable worktree (git reports its directory gone) has nothing to dirty-check: rm only drops its stale registration and says so in a warning, as `hop clean` does for prunable candidates. If multiple worktrees hold the same branch, the branch-only CLI refuses rather than guessing; the picker carries the selected path through the lock-protected re-validation. `--ext` is a deprecated no-op (kept only for backward compatibility; passing it prints a deprecation warning) |
| `hop clean [--yes\|--dry-run]` | Auto-detects and removes garbage worktrees (below). Targets managed worktrees only by default (`--ext` extends the target to external ones as well, unchanged from before) |
| `hop root <branch>` | Temporarily switches root for verification purposes. Even if the target branch is already checked out on another worktree (the "holder"), swaps it out as long as the holder is clean and not git-locked — the holder is set to detached HEAD to free up the branch. Refuses if the holder is dirty/locked, or a stale registration git reports as prunable. `hop root -` returns (using git's `@{-1}`, no state file needed — this restores only root's branch; a holder detached by the swap is not re-attached) |

## The 3 worktree categories

| Category | Definition | Allowed operations |
|---|---|---|
| root | The main clone | `cd` / temporary switching via `hop root <branch>` only. Never used for editing |
| managed | Under `_worktree/<repo>/` (created by nuthatch) | `cd` / `rm` / `clean`, all allowed |
| external | Everything else (created by Claude Code's EnterWorktree, Codex, etc.) | `cd` / listing / jump / `rm` allowed. Not included in `clean`'s automatic candidates (can be included explicitly with `--ext`) |

**Safety rule (most important):** "visible and reachable" is kept separate
from "nuthatch may change it." Jumping to an external worktree is always
allowed. `hop` can now `rm` an external worktree with the same procedure as
a managed one (dirty check → overridable with `--force`), but deleting from
the picker always requires a y/N confirmation for an external worktree (to
avoid accidentally destroying another agent's in-progress session — the
existing confirmation behavior for managed worktrees is unchanged). Any
worktree git itself reports as locked is always refused — for `rm` as well
as for the holder swap in `hop root` — regardless of `--force`; hop never
calls `git worktree unlock` automatically. `hop clean`'s automatic targets
remain managed-only (external can be added explicitly with `--ext`).
Picker-triggered mutations carry the selected worktree path into the
lock-protected re-validation. If the holder/target changed, or an external
holder appeared after an unconfirmed picker selection, the mutation is
refused instead of acting on the newly discovered worktree.
Category classification uses realpath plus path-boundary comparison, never
a string-prefix comparison.

## hop clean — garbage detection

A worktree is never a candidate if removing it would lose anything.

| Judgment | Condition |
|---|---|
| prunable | git reports it as prunable (this alone makes the worktree a candidate; the branch's safety is judged separately) |
| merged | The branch is merged into origin/HEAD (or main/master if that's unavailable), and the worktree is clean |
| gone | The upstream is `[gone]`, no commit is unreachable from origin/HEAD, and the worktree is clean. If this can't be determined, deletion is refused |

- Targets managed worktrees only; external ones only when `--ext` is passed
  explicitly.
- TTY: presents the candidate list (branch / reason / path) for a single
  batch confirmation. Non-TTY: `--dry-run` returns the candidates as JSON,
  and `--yes` executes.
- `--with-branch` also deletes the branch itself (only when merged/gone has
  been confirmed). Since a prunable worktree has already disappeared, if the
  branch's merged/gone status can't be separately confirmed, only the
  worktree is removed, the branch is kept, and the reason is emitted as a
  warning on stderr.

## hop root — verification session

For cases (e.g. Docker) where verification can only happen in the root
clone.

- Refuses to switch if root is dirty (including untracked changes).
- Even if the target branch is already checked out on another worktree (the
  "holder"), it is **swapped**, as long as the holder is clean and not
  git-locked: the holder is switched to `git switch --detach` to free up the
  branch, and root is switched onto it. If the holder is dirty, locked, or a
  stale registration git reports as prunable, the switch is refused and its
  path is reported.
- All checks are re-validated inside the repo lock (the holder's
  dirty/lock/branch state is re-read after acquiring the lock, then
  detached — a TOCTOU guard). Picker-triggered swaps also re-validate the
  selected holder path and whether a newly discovered external holder was
  explicitly confirmed; a mismatch is refused without detaching anything.
- If root's switch fails after the holder has been detached, the holder is
  rolled back to its pre-detach branch before returning the failure (never
  leaving the holder in a half-finished state).
- Returning (`hop root -`) is delegated to git's `@{-1}`. On failure, root's
  branch is rolled back. **The holder is never re-attached** — a holder
  detached by a swap stays in detached HEAD even after `hop root -`.
- `--json`'s `data.detachedHolder` returns the path of the holder detached
  by the swap (`null` if none). The human-readable output writes
  `Put <path> into detached HEAD` to stderr.

## CLI contract (fixed as spec)

- **stdout**: On a successful `cd`-type command, only the path (a path
  containing a newline is explicitly unsupported). A listing is a table or
  JSON. Logs, warnings, and the picker always go to stderr.
- **JSON**: every command returns
  `{schemaVersion, command, data, warnings}`. The schema's backward
  compatibility is pinned by snapshot tests.
- **exit code**: 0=success (including a picker Esc cancel, with empty
  stdout) / 1=generic error / 2=usage error / 3=safety rejection (e.g.
  dirty) / 130=SIGINT (a picker Ctrl+C cancel is treated the same way). The
  shell wrapper preserves the exit code and `cd`s only when rc=0 and stdout
  is non-empty.
- **mutation exclusivity**: every mutation (create / rm / clean / switching
  root) runs "re-validate → execute" inside a per-repo, cross-process lock.
  The lock is created with `mkdir` under the git common dir, records PID,
  start time, and a token, and is refreshed with a heartbeat while held.
  Reclaiming it requires both confirming the process is dead and the TTL
  having expired. If that can't be confirmed, the safe default is to
  refuse with the normal structured result and exit code 3.
- **git execution**: always spawned with an argv array (never string
  concatenation), and always by **absolute path**: hop resolves the git
  binary itself — every absolute `PATH` entry in order, then a small
  best-effort list of conventional install dirs (see
  `src/domain/git-executable.ts`) — so a PATH that never went through the
  user's shell profile still finds git. Relative `PATH` entries are skipped
  (a repo-local `git` must never be what hop runs). `HOP_GIT` overrides the
  search with an absolute path and is then the only candidate. If no
  candidate is an executable file, hop exits 1 with `git executable not
  found. Looked in: …` naming every place it looked. A git failure maps to
  exit 3.
- **fatal errors**: anything that escapes the command dispatch is reported
  through the same path as a rejection the command returned itself — a
  single `hop: <message>` line on stderr (a git failure shows git's own
  stderr), the intact JSON envelope on stdout when `--json` was requested,
  and the exit code from the list above — never a JS stack trace. Plain
  (non-JSON) runs keep stdout empty, so the shell wrapper never `cd`s after
  a crash.
- **creating from a remote branch**: if origin has a branch of the same
  name, origin always wins. If origin doesn't have it but multiple other
  remotes do, this is an ambiguity error. The created branch uses
  `--track`.

## Architecture — loosely coupled, component-oriented

Applies a lightweight ports & adapters (hexagonal) style. All external
dependencies (git subprocess / fs / TTY) are isolated in `infra/`; domain
logic is pure functions with zero external dependencies.

```
src/
├── cli.ts               # Entry point. citty parses args → runs a command → renders the result
├── domain/              # Pure functions only. May only import from within domain
│   ├── model.ts         #   Worktree type (kind: root|managed|external)
│   ├── porcelain.ts     #   worktree list --porcelain parser
│   ├── sanitize.ts      #   branch name → dir name
│   ├── classify.ts      #   root/managed/external classification
│   ├── tracking.ts      #   which remote branch a new branch tracks (origin wins)
│   ├── garbage.ts       #   garbage detection for clean
│   ├── git-executable.ts #  where the git binary may live (candidate list)
│   └── fatal-error.ts   #   escaped error → message + exit code
├── infra/               # The only place with external dependencies. Implements domain's ports
│   ├── git.ts           #   node:child_process execFile (argv array only)
│   ├── git-executable.ts #  probes the candidates, caches the absolute path
│   ├── fs.ts            #   realpath / exists / mkdir / readdir
│   ├── repo.ts          #   classified worktree list, dirty check, how to check out a branch
│   ├── lock.ts          #   per-repo mutation lock (withRepoLock)
│   └── term.ts          #   TTY detection, stderr logging
├── cli-fatal.ts         # cli.ts only: renders an escaped error (hop: … + envelope)
├── commands/             # 1 command = 1 component. Cross-imports forbidden
│   ├── jump.ts / ls.ts / pick.ts / rm.ts / clean.ts / root.ts / init.ts
│   │                    #   ★ Never renders. Only returns a structured Result
├── ui/                  # Self-drawn picker (raw-mode stdin, alternate screen on stderr). Wired to commands only via cli-pick.ts
└── render.ts            # cli layer only: Result → plain / JSON. Never imported from commands
shell/init.zsh           # Template for `hop init zsh` (strict quoting, idempotent)
```

- **Tests sit next to the code** (`foo.ts` → `foo.test.ts`): domain gets unit
  tests; commands get integration tests against a real git repo in a tmpdir.

- **Dependencies flow one way**: cli.ts/render.ts → commands → infra →
  domain (commands may use both infra and domain). domain depends on nothing.
- **commands never render**: they return a structured Result, and
  cli.ts + render.ts do the rendering (no shared output module exists,
  since that would be a cross-cutting dependency).
- The arg parser is **citty**. Parser-specific types never flow into
  commands.
- Subprocess calls use **node:child_process** — this works for both the npm
  build (Node 22+) and the compiled build (Bun).

## Implementation stack

| Item | Choice | Notes |
|---|---|---|
| Language | TypeScript | Development runtime is bun |
| Minimum versions | git >= 2.36 / node >= 22 / bun >= 1.1 | Range supporting porcelain -z and compilation |
| TUI | self-drawn (no TUI dependency) | Raw-mode stdin + alternate screen on stderr, TTY only; without a TTY, bare `hop` prints a listing instead |
| arg parser | citty | Rolling our own is forbidden |
| lint/format | oxlint / oxfmt | |
| Testing | bun test | unit (domain) + integration (real repo in a tmpdir, GIT_CONFIG_NOSYSTEM=1 / isolated HOME / hooks disabled / LC_ALL=C / injected clock) |
| Distribution | npm + GitHub Releases | The npm build is a Node-executable bundle in dist/ via bun build. Binaries are built with bun compile (darwin-arm64/x64, linux-x64) |

## Release procedure (fixed order)

build (verify tag `vX.Y.Z` matches the `package.json` version) → `npm pack`
→ smoke test the npm build, linux-x64, and darwin-arm64 → darwin-x64 is
compile-checked only → generate SHA-256 for each binary → npm publish
(--access public, provenance; skip if the same version already exists) →
attach to the Release. **publish happens last** (to avoid publishing a
broken version).

Publishing to npm uses Trusted Publishing (OIDC, token-less), and **only a
staged publish is allowed**. CI's publish step goes only as far as staging;
final publication is manually promoted on npmjs.com (a supply-chain
safeguard).

The GitHub Actions macOS runner runs an execution smoke test for
darwin-arm64. Since there's no runner available to execute on for
darwin-x64, only a successful compile is confirmed for it; install.sh
verifies the binary against the `.sha256` attached to the Release before
placing it.

## Install (post-release)

```sh
npm i -g @n-seiji/nuthatch          # npm / bun
mise use -g npm:@n-seiji/nuthatch   # mise
curl -fsSL https://raw.githubusercontent.com/n-seiji/nuthatch/main/install.sh | sh  # binary
```

Shell integration is a single line in `.zshrc`:
`eval "$(hop init zsh)"` (the same approach as starship / zoxide).

## Background

- Previous implementation: dotfiles' bash-based `wt` (fixed 10 slots).
  Problems: the slot limit, `wt list` being slow due to sequential git
  calls, no integration with worktrees created by agents, and dirty
  detection missing untracked files.
- Design review: went through multiple rounds with codex gpt-5.6-sol
  (incorporating external protection, TOCTOU/lock handling, gone detection,
  npm/Bun compatibility, release ordering, and more).

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
auto-`cd`. `--update` and `--version` are flags, not reserved words (see
[Self-update](#self-update)), so the reserved list stays at five.

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
| `hop ls [--json]` | Listing: branch / path / category / dirty / ahead-behind. Plain output is a table for humans (below); `--json` is the contract for tools. `dirty` is `false` for an entry with no working tree to inspect (bare, prunable, or git-locked with its directory missing) — check `prunable` / `locked` as well |
| `hop rm <branch>` | Removes the worktree (the branch is kept). Refuses if dirty (including untracked), overridable with `--force`. Does not distinguish managed from external. Always refuses a worktree git reports as locked, `--force` or not (`git worktree unlock` is never called). A worktree git reports as prunable is not dirty-checked (there is no working tree to check): rm drops its stale registration with a warning — the same policy as `hop clean`'s prunable candidates — and if a directory without a valid `.git` file is still at that path, git itself refuses (exit 3). If multiple worktrees hold the same branch, the branch-only CLI refuses rather than guessing; the picker carries the selected path through the lock-protected re-validation. `--ext` is a deprecated no-op (kept only for backward compatibility; passing it prints a deprecation warning) |
| `hop clean [--yes\|--dry-run]` | Auto-detects and removes garbage worktrees (below). Targets managed worktrees only by default (`--ext` extends the target to external ones as well, unchanged from before) |
| `hop root <branch>` | Temporarily switches root for verification purposes. Even if the target branch is already checked out on another worktree (the "holder"), swaps it out as long as the holder is clean and not git-locked — the holder is set to detached HEAD to free up the branch. Refuses if the holder is dirty/locked, or a stale registration git reports as prunable. `hop root -` returns (using git's `@{-1}`, no state file needed — this restores only root's branch; a holder detached by the swap is not re-attached) |

**`hop ls`'s table.** One row per worktree, root → managed → external
(branch name ascending, detached last), then a summary line:

```
  BRANCH              STATE      REMOTE  KIND      PATH
  main                ✓ clean    -       root      ~/ghq/github.com/me/app
@ feat/login          ● changes  ↑1      managed   ~/ghq/github.com/me/_worktree/app/feat__login
  fix/typo-in-readme  ✓ clean    ↓1      managed   ~/ghq/github.com/me/_worktree/app/fix__typo-in-readme
  claude/agent-x      ✓ clean    -       external  ~/.claude-wt/agent-x

4 worktrees · 1 with changes · 1 ahead · 1 external
```

`@` marks the worktree the current directory is in. STATE is one value,
most important first: `✗ missing` (prunable), `⊘ locked`, `- bare`,
`● changes` (dirty), `✓ clean`. REMOTE is commits ahead `↑` / behind `↓` the
upstream, `=` in sync, `-` no upstream. Only the path shrinks (keeping its
tail) to fit the terminal width. Colors only when stdout is a terminal and
`NO_COLOR` is unset; the layout is for people and may change, so scripts use
`--json`. The zsh wrapper captures stdout only for commands that may `cd`, so
`hop ls` reaches the terminal directly and keeps its colors.

### Self-update

| Command | Behavior |
|---|---|
| `hop --update` | Replaces the running binary with the latest release, **only if it is a compiled standalone binary** (what `install.sh` installs). Any other install is refused with a one-line hint and runs nothing |
| `hop --update --check` | Reports only: `current`, `latest`, whether an update is available, the detected `method`, and what `--update` would do. It reads the install facts and asks GitHub for the latest version, nothing else: it never downloads a binary, never writes (so it never checks that the install dir is writable either), never spawns anything |
| `hop --version` | Prints hop's version (`package.json`'s, e.g. `0.1.5`) on stdout, exit 0 |

`--update` and `--version` are **flags, not reserved words**: a git branch name
cannot start with `-`, so the five reserved names stay five and no `--`
escape is needed. Like `--help`, only the first argument counts (`hop --
--update` is still an escaped jump). After `--update` only `--check` and
`--json` are accepted; anything else is a usage error (exit 2), so a typo such
as `--chek` can never turn a read-only check into a real update. The exception
is `--help` / `-h` anywhere after `--update`: it prints the usage like `hop
--help` and exits 0, without checking or updating anything.

**How hop was installed** is decided before anything goes over the network,
from the realpath of the running executable (a compiled binary) or entry
script (`src/infra/install-facts.ts` gathers it, `src/domain/install-method.ts`
decides; the path is realpath'd first because an npm bin and a mise `latest`
are symlinks). hop only replaces what it can replace safely, so the rules are
a handful of path checks, first match wins:

| # | Path of the running hop | `method` | `--update` does | `--update` hint (stderr, exit 1) |
|---|---|---|---|---|
| 1 | contains `/mise/installs/` (a binary or an npm package) | `mise` | refuses | `Update with mise: mise upgrade` |
| 2 | a script (not compiled) whose path contains `/node_modules/`: npm / bun / pnpm / yarn global, npx, a project dependency | `package-manager` | refuses | `Update with your package manager, e.g. npm i -g @n-seiji/nuthatch@latest` |
| 3 | a script anywhere else (`bun run src/cli.ts`, a source checkout) | `other` | refuses | `Update hop with the tool you installed it with.` |
| 4 | a compiled binary inside another tool's tree: `/Cellar/` or `/Caskroom/` (Homebrew), `/nix/store/`, `/aquaproj-aqua/`, `/aqua/pkgs/`, `/.proto/`, or any `/installs/` (asdf-style) | `other` | refuses | `Update hop with the tool you installed it with.` |
| 5 | a compiled binary on a platform with no prebuilt asset (anything but darwin-arm64 / darwin-x64 / linux-x64) | `other` | refuses | `Update hop with the tool you installed it with.` |
| 6 | any other compiled binary | `standalone` | replaces it (below) | none |

The refusal is the whole message: one line on stderr, nothing on stdout, exit
1, and no request is made. hop never runs `mise`, `npm`, `bun` or any other
tool itself, and never looks for one on `PATH`. A path that merely looks like a
mise or npm layout is classified by the path alone; hop does not read mise's
marker files or verify npm's prefix, so the hint can be generic (an `npm i -g`
into a mise-managed node reads as `mise`, for instance). Trees that keep their
own copy of a binary (rows 4) are refused because swapping the file in place
would leave their bookkeeping describing a version that is no longer there
(and the Nix store is read-only); the check is a path-segment match on the real
path, so it errs on the side of refusing, and a binary from `install.sh` or one
copied to `~/.local/bin` is unaffected.

**Latest version.** Always GitHub: `GET
https://api.github.com/repos/n-seiji/nuthatch/releases/latest`, field
`tag_name`. Versions are plain `x.y.z`, compared numerically; anything else is
an error rather than a guess. An installed version that is the same as or
newer than the latest is never "updated": no downgrade. For `--check`, the
non-standalone methods look the version up too and then report the hint instead
of acting.

**Standalone replacement.** Once the latest-version lookup has shown there is
something to install, and before downloading the binary or its checksum (never
for `--check`), hop checks that the binary's directory is writable (write and
search permission, not a read-only filesystem), so an unwritable install dir is
learned in milliseconds rather than after tens of MB. It then downloads
`hop-<os>-<arch>.sha256` and `hop-<os>-<arch>` from the *resolved* tag
(`.../releases/download/v<latest>/...`, never `latest/download`, so a release
published between the check and the download cannot swap the binary). The
SHA-256 of the downloaded bytes must equal the digest in the `.sha256` file
(the check install.sh makes): its first token is the digest, and if a second
token names a file (`sha256sum` writes `out/hop-<os>-<arch>`) that file must be
this asset, since a digest of some other file cannot verify this one; a digest
alone is accepted. Only then is the binary replaced: hop writes a hidden temp
file next to the real binary (`.hop.update-<hex>` in the realpath's directory,
so a `~/.local/bin/hop` symlink's target is what changes), mode 0755, `fsync`s
it, then `rename`s it over the binary: atomic, and the temp file is removed on
any failure. A mismatch, or a `.sha256` that is malformed or names a different
file, refuses the install (exit 3, nothing written); a `.sha256` or binary that
cannot be downloaded at all (a 404, a timeout) is a network failure, exit 1. A
directory hop cannot write to is exit 1 (`Cannot write <dir>; reinstall hop
somewhere writable (install.sh uses ~/.local/bin).`), whether it is
permissions (EACCES / EPERM) or a read-only filesystem (EROFS).

**Output.** stdout carries only the data. Plain, it is the data as 2-space
pretty JSON, like `hop rm`:

```json
{
  "current": "0.1.4",
  "latest": "0.1.5",
  "updateAvailable": true,
  "method": "standalone",
  "action": "replaced",
  "command": null
}
```

With `--json` it is the envelope, on one line, with that same object as `data`
(`warnings` is always `[]`):

```json
{"schemaVersion":1,"command":"update","data":{"current":"0.1.4","latest":"0.1.5","updateAvailable":true,"method":"standalone","action":"replaced","command":null},"warnings":[]}
```

`method` is `standalone` / `mise` / `package-manager` / `other`. `action` is
what hop itself did: `none` (already up to date, or `--check`) or `replaced`
(the standalone binary was swapped). `command` is the argv a user would run to
update a `mise` (`["mise","upgrade"]`) or `package-manager`
(`["npm","i","-g","@n-seiji/nuthatch@latest"]`) install, reported by `--check`
when an update is available; hop never runs it. Otherwise `null`, always for
`standalone` and `other`. Progress (`Checking...`, `Downloading...`) and the
hint go to stderr. A refusal or any other failure leaves `data` out of the
envelope and puts the message on stderr. The zsh wrapper needs no change:
`--*` already means "don't `cd`".

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
existing confirmation behavior for managed worktrees is unchanged), and for
a prunable one, since its removal cannot be dirty-checked. Any
worktree git itself reports as locked is always refused — for `rm` as well
as for the holder swap in `hop root` — regardless of `--force`; hop never
calls `git worktree unlock` automatically. `hop clean`'s automatic targets
remain managed-only (external can be added explicitly with `--ext`).
Picker-triggered mutations carry the selected worktree path into the
lock-protected re-validation. If the holder/target changed, an external
holder appeared, or the target turned prunable after an unconfirmed picker
selection, the mutation is refused instead of acting on the newly
discovered state.
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
  JSON. Logs, warnings, and the picker always go to stderr. `hop --version`
  prints the version alone; `hop --update` prints only its data (below).
- **JSON**: every command returns
  `{schemaVersion, command, data, warnings}`. The schema's backward
  compatibility is pinned by snapshot tests. `hop --update --json` is
  `command: "update"` with `data` = `{current, latest, updateAvailable,
  method, action, command}` (see [Self-update](#self-update)); when it fails
  `data` is omitted and the message is on stderr.
- **exit code**: 0=success (including a picker Esc cancel, with empty
  stdout) / 1=generic error / 2=usage error / 3=safety rejection (e.g.
  dirty) / 130=SIGINT (a picker Ctrl+C cancel is treated the same way). The
  shell wrapper preserves the exit code and `cd`s only when rc=0 and stdout
  is non-empty. For `hop --update`: 0=updated, already up to date (never a
  downgrade), or `--check`; 1=an install hop does not replace (the one-line
  hint is the message: mise, a package manager's `node_modules`, a source
  checkout, a binary inside another tool's tree, no prebuilt binary for the
  platform), a network / HTTP failure (including a download that cannot be
  fetched at all, such as a missing `.sha256`, a response over its size cap,
  and GitHub's API rate limit), or a binary directory it cannot write; 3=a
  downloaded binary that fails its checksum, or whose `.sha256` is malformed
  or names a different file: hop refuses to install an unverified binary, and
  nothing is written.
- **network access**: `hop --update` is the only thing hop does over the
  network: HTTPS GETs to fixed GitHub URLs (never a user-supplied URL;
  the URL a request finally lands on after any redirects must be HTTPS — only
  that final URL is checked, and integrity is the checksum's job, not the
  transport's), each with a timeout (15 s for metadata, 5 min for the binary)
  and a size cap on what it will read (1 MiB for the JSON metadata, 4 KiB for
  a `.sha256`, 256 MiB for a binary): a `Content-Length` over the cap is
  refused before a byte is read, and the bytes actually received are counted
  too, so a missing or wrong header does not lift the cap. A response that is
  refused (a non-2xx status, a final URL that is not HTTPS) is cancelled
  unread. A GitHub API refusal that is the exhausted anonymous quota (403 /
  429 with `x-ratelimit-remaining: 0`) says so and to retry later. A
  downloaded binary is verified against the `.sha256` attached to the same
  release before it replaces anything — the check install.sh makes, with the
  same trust root: it catches a corrupt or truncated download, not a
  compromised release.
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
├── cli.ts               # Entry point. Parses args → runs a command → renders the result
├── cli-args.ts          # cli.ts only: the small argv parser (flags / positionals)
├── domain/              # Pure functions only. May only import from within domain
│   ├── schema.ts        #   valibot schemas: the JSON output contract and the Worktree type (kind: root|managed|external)
│   ├── porcelain.ts     #   worktree list --porcelain parser
│   ├── sanitize.ts      #   branch name → dir name
│   ├── classify.ts      #   root/managed/external classification
│   ├── tracking.ts      #   which remote branch a new branch tracks (origin wins)
│   ├── garbage.ts       #   garbage detection for clean
│   ├── git-executable.ts #  where the git binary may live (candidate list)
│   ├── install-method.ts #  how this hop was installed → standalone (replaced) or a hint
│   ├── posix-path.ts    #   parentDir / shortenHome (domain cannot import node:path)
│   ├── ansi.ts          #   ESC and the SGR codes shared by hop ls and the picker
│   ├── self-update.ts   #   versions, checksum file, fixed release URLs
│   └── fatal-error.ts   #   escaped error → message + exit code
├── infra/               # The only place with external dependencies. Implements domain's ports
│   ├── git.ts           #   node:child_process execFile (argv array only)
│   ├── git-executable.ts #  probes the candidates, caches the absolute path
│   ├── executable.ts    #   first executable file among candidates (used by the git lookup)
│   ├── fs.ts            #   realpath / exists / mkdir / readdir
│   ├── repo.ts          #   classified worktree list, dirty check, how to check out a branch
│   ├── lock.ts          #   per-repo mutation lock (withRepoLock)
│   ├── term.ts          #   TTY detection, stderr logging
│   ├── install-facts.ts #   realpath of the running binary / script → the facts install-method.ts decides on
│   ├── release-http.ts  #   --update's only network access: fixed GitHub HTTPS GETs
│   ├── capped-body.ts   #   reads a response body up to a size cap (Content-Length + counted bytes)
│   ├── release-binary.ts #  sha256, writability check, atomic fsynced replacement of the running binary
│   └── self-update.ts   #   assembles the three above into the SelfUpdatePort
├── cli-fatal.ts         # cli.ts only: renders an escaped error (hop: … + envelope)
├── cli-update.ts        # cli.ts only: `--update` argument parsing, wiring, reporting
├── version.ts           # cli.ts only: hop's version, inlined from package.json
├── commands/             # 1 command = 1 component. Cross-imports forbidden
│   ├── jump.ts / ls.ts / pick.ts / rm.ts / clean.ts / root.ts / init.ts / self-update.ts
│   │                    #   ★ Never renders. Only returns a structured Result
│   │                    #   init.ts holds the `hop init zsh` template (strict quoting, idempotent)
├── ui/                  # Self-drawn picker (raw-mode stdin, alternate screen on stderr). Wired to commands only via cli-pick.ts
└── render.ts            # cli layer only: Result → plain / JSON. Never imported from commands
```

- **Tests sit next to the code** (`foo.ts` → `foo.test.ts`): domain gets unit
  tests; commands get integration tests against a real git repo in a tmpdir.

- **Dependencies flow one way**: cli.ts/render.ts → commands → infra →
  domain (commands may use both infra and domain). domain depends on nothing.
- **commands never render**: they return a structured Result, and
  cli.ts + render.ts do the rendering (no shared output module exists,
  since that would be a cross-cutting dependency).
- The arg parser is hop's own `cli-args.ts` (citty was dropped to keep
  startup fast). Parser-specific types never flow into commands.
- Subprocess calls use **node:child_process** — this works for both the npm
  build (Node 22+) and the compiled build (Bun).

## Implementation stack

| Item | Choice | Notes |
|---|---|---|
| Language | TypeScript | Development runtime is bun |
| Minimum versions | git >= 2.36 / node >= 22 / bun >= 1.1 | Range supporting porcelain -z and compilation |
| TUI | self-drawn (no TUI dependency) | Raw-mode stdin + alternate screen on stderr, TTY only; without a TTY, bare `hop` prints a listing instead |
| arg parser | in-house (`src/cli-args.ts`) | Keeps citty's (mri's) rules; citty pulled in consola and slowed startup |
| lint/format | oxlint / oxfmt | |
| Testing | bun test | unit (domain) + integration (real repo in a tmpdir, GIT_CONFIG_NOSYSTEM=1 / isolated HOME / hooks disabled / LC_ALL=C / injected clock) |
| Distribution | npm + GitHub Releases | The npm build is a Node-executable bundle in dist/ via bun build. Binaries are built with bun compile (darwin-arm64/x64, linux-x64) |

## Release procedure (fixed order)

A release starts from either a pushed `vX.Y.Z` tag or a push to main whose
`package.json` version has no tag yet (a merged version bump; also runnable
by hand via workflow_dispatch). In the second case the tag is created by
the Release step at the very end, on the pushed commit, so a failed run
leaves no tag behind. A main push whose version is already tagged does
nothing.

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
darwin-x64, only a successful compile is confirmed for it; install.sh and
`hop --update` both verify the binary against the `.sha256` attached to the
Release before placing it.

## Install (post-release)

```sh
npm i -g @n-seiji/nuthatch          # npm / bun
mise use -g npm:@n-seiji/nuthatch   # mise
curl -fsSL https://raw.githubusercontent.com/n-seiji/nuthatch/main/install.sh | sh  # binary
```

`hop --update` updates it in place whichever way it was installed (see
[Self-update](#self-update)).

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

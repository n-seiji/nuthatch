# AGENTS.md

Guide for coding agents (Claude Code / Codex, etc.) working in this repo.

## Repository Overview

`nuthatch` — a git worktree manager. The command users run is `hop`.
The source of truth for design is [docs/design.md](docs/design.md). Read it
before implementing anything.

## Directory Layout and Responsibilities

```
src/                 # Implementation (TypeScript, bun). Tests live next to the file under test (*.test.ts)
src/testing/         # Test-only shared helpers (e.g. building a real tmpdir git repo). Imported only from tests
docs/design.md       # Design document (source of truth)
skills/              # Symlink to plugins/hop/skills (the plugin side is the source of truth)
plugins/hop/         # Published plugin (supports both Claude Code and Codex). skills/ is a symlink into it
.claude/rules/       # Development-only rules (used only while developing this repo, never distributed)
.claude-plugin/      # Claude Code marketplace index
.agents/plugins/     # Codex marketplace index
shell/               # Template for `hop init zsh`
```

- **Colocate tests with the implementation file.** For example, the test for
  `src/domain/porcelain.ts` is `src/domain/porcelain.test.ts`. Integration
  tests that span multiple commands are named `<concern>.integration.test.ts`
  and live in the directory of the command they target (e.g.
  `src/commands/jump-ls-rm.integration.test.ts`). Shared helpers go in
  `src/testing/`.

- **The source of truth for the published skill is `plugins/hop/skills/`**
  (the Codex plugin installer doesn't expand symlinks, so the real files live
  on the plugin side). The `skills/` symlink at the repo root exists only for
  discoverability. Keep the plugin installable from both Claude Code and
  Codex (`.claude-plugin/plugin.json` + `.codex-plugin/plugin.json`).
- **Development-only rules/skills** live under `.claude/`. Never include them
  in distributed artifacts.

## Architecture Constraints (violating PRs are rejected)

Dependencies flow in one direction only, onion-style:
`cli.ts/render.ts → commands → infra → domain` (`commands` may depend on both
`infra` and `domain`). `domain` is the innermost layer with zero external
dependencies so that its decision logic (worktree classification, sanitizing,
garbage detection, etc.) keeps being unit-testable on its own even as the
CLI's I/O or command structure changes. `infra` is the sole gateway to
subprocess/fs so that git/fs call conventions (spawn with an argv array,
never string concatenation) stay confined to one place and can be swapped
out behind ports in tests. `commands` never render so that changing the
output format (plain/JSON) can never leak into the decision logic.

- `domain/` contains only pure functions. It must not import external
  dependencies (subprocess / fs / TTY / clock / random / Node built-ins).
- Never call subprocess/fs directly outside `infra/`. git is always spawned
  with an argv array (never string concatenation). Subprocess calls use
  `node:child_process` (so both the npm/Node build and the compiled Bun
  binary work).
- `commands/` never render; they return a structured `Result`.
- The CLI contract (stdout / JSON schema / exit codes) follows the
  definitions in docs/design.md — any change must come with a matching
  update to the design document.

The dependency direction above, the ban on `any`, the ban on calling
`console` directly, circular imports, and cross-imports between `commands/`
are all mechanically enforced by `.oxlintrc.json` (`no-restricted-imports`
per layer + `import/no-nodejs-modules`). What's written here is only the
"why" behind the design that lint can't express.

## Development Workflow

- Test-first (TDD). `domain` gets unit tests; `commands` get integration
  tests against a real git repo in a tmpdir.
- Integration tests run with `GIT_CONFIG_NOSYSTEM=1` /
  `GIT_CONFIG_GLOBAL=/dev/null` / an isolated `HOME` / hooks disabled /
  `LC_ALL=C`.
- Verification commands:

```bash
bun test              # all tests
bun run typecheck     # tsc --noEmit
bun run lint          # oxlint
bun run format:check  # oxfmt --check
```

- `hop` treats every worktree it can see — managed or external, regardless
  of who created it — as a valid target for moving, deleting, or swapping
  out of root. Being `external` is not by itself a reason to refuse
  mutation. The safety net that makes this workable is the most important
  safety rule:
  - Refuse a dirty worktree (overridable with `--force`).
  - Always refuse a worktree git itself reports as locked, `--force` or not
    (hop never removes a lock itself).
  - Deleting an external worktree from the picker or via Ctrl+X always
    requires a y/N confirmation.
  - `hop clean`'s automatic candidates are managed worktrees only (external
    ones are never auto-deleted).
  - Every mutation acquires the repo lock, then re-validates before acting.
  Any change touching destructive operations must re-read "The 3 worktree
  categories" and "CLI contract" in docs/design.md.

## Working Rules

- For multi-step work, clarify what's changing and how it will be verified
  before touching code.
- After making a change, run the verification commands relevant to what you
  touched and share the results.
- Before committing, review how secrets, permissions, and input boundaries
  are handled.
- Commit messages follow Conventional Commits
  (feat/fix/refactor/docs/test/chore/ci).

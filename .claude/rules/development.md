# nuthatch development rules (development-only, not distributed)

- The source of truth for design is docs/design.md. Any change to the CLI
  contract (stdout / JSON schema / exit codes) must come with a matching
  update to the design document.
- Dependency direction (onion): cli/render → commands → infra → domain
  (`commands` may depend on either infra or domain). `domain` is the
  innermost layer (pure functions only, Node built-ins forbidden too) so
  the decision logic stays unit-testable even as the CLI's structure
  changes.
- `commands` never render (they return a structured Result), so that
  changing the output format never leaks into the decision logic.
- Subprocess calls use node:child_process, always with an argv array. No
  external dependency is touched outside infra/.
- Test-first. Integration tests use a real repo in a tmpdir plus
  GIT_CONFIG_NOSYSTEM=1 / isolated HOME / LC_ALL=C.
- Colocate tests with the implementation file
  (`src/domain/porcelain.ts` → `src/domain/porcelain.test.ts`). Shared
  helpers go in `src/testing/`.
- Mutations (create/rm/clean/switching root) run "re-validate → execute"
  inside the repo lock.
- hop treats every worktree — managed or external, regardless of who
  created it — as a valid target for `rm`/switching root. The safety net
  is: refuse dirty (overridable with `--force`); always refuse
  git-locked, `--force` or not (never removes the lock); require y/N for
  deleting external from the picker/Ctrl+X; and `hop clean`'s automatic
  candidates are managed only (the 4 most important safety rules).
- The dependency direction above, the ban on `any`, the ban on calling
  `console` directly, circular imports, and cross-imports between commands
  are all mechanically enforced by oxlint (`.oxlintrc.json`'s
  `no-restricted-imports` per layer + `import/no-nodejs-modules`). Write
  only the design intent that lint can't express here.

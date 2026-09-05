# AGENTS.md

この repo で作業する coding agent (Claude Code / Codex 等) 向けガイド。

## Repository Overview

`nuthatch` — git worktree manager。ユーザーが使うコマンド名は `hop`。
設計の正本は [docs/design.md](docs/design.md)。実装前に必ず読むこと。

## ディレクトリ構成と責務

```
src/                 # 実装 (TypeScript, bun)。テストは対象ファイルと同階層に置く (*.test.ts)
src/testing/         # テスト専用の共有 helper (tmpdir 実 git repo 生成など)。テストからのみ import
docs/design.md       # 設計書 (source of truth)
skills/              # plugins/hop/skills へ の symlink (正本は plugin 側)
plugins/hop/         # 公開 plugin (Claude Code / Codex 両対応)。skills へは symlink
.claude/rules/       # 開発専用 rule (この repo の開発時のみ使う。配布しない)
.claude-plugin/      # Claude Code marketplace index
.agents/plugins/     # Codex marketplace index
shell/               # hop init zsh のテンプレート
```

- **テストは実装ファイルと同じディレクトリに置く** (colocate)。例: `src/domain/porcelain.ts` の
  テストは `src/domain/porcelain.test.ts`。複数コマンドをまたぐ integration test は
  `<関心事>.integration.test.ts` のように命名し、対象コマンドが属するディレクトリに置く
  (例: `src/commands/jump-ls-rm.integration.test.ts`)。共有 helper は `src/testing/`。

- **公開 skill の正本は `plugins/hop/skills/`** (Codex の plugin installer が symlink を展開しないため実体は plugin 側に置く)。repo ルートの `skills/` は発見用の symlink。Claude Code と Codex の両方から
  install できる形式 (`.claude-plugin/plugin.json` + `.codex-plugin/plugin.json`) を保つ。
- **開発専用 rule / skill** は `.claude/` 配下。配布物に含めない。

## アーキテクチャ制約 (違反 PR は reject)

依存方向はオニオン構造の一方向のみ: `cli.ts/render.ts → commands → infra → domain`
(`commands` は `infra` と `domain` の両方に依存してよい)。domain が最内層で外部に一切依存しない
のは、CLI の入出力やコマンド構成が変わっても判定ロジック (worktree 分類・sanitize・garbage 判定
など) を単体でテストし続けられるようにするため。infra を subprocess/fs の唯一の窓口にしている
のは、git や fs の呼び出し規約 (argv 配列で spawn、文字列連結禁止) を 1 箇所に閉じ込め、
テスト時にはポート越しに差し替えられるようにするため。commands が描画しないのは、出力形式
(plain/JSON) の変更が判定ロジックに波及しないようにするため。

- `domain/` は純関数のみ。外部依存 (subprocess / fs / TTY / clock / random / node 組み込み) を
  import しない
- `infra/` 以外で subprocess / fs を直接呼ばない。git は常に argv 配列で spawn (文字列連結禁止)。
  subprocess は `node:child_process` (npm 版 Node / compile 版 Bun 両対応のため)
- `commands/` は描画せず構造化 Result を返す
- CLI 契約 (stdout / JSON schema / exit code) は docs/design.md の定義に従い、変更は設計書の更新とセットで行う

上記の依存方向・`any` 禁止・console 直書き禁止・循環 import・`commands/` 相互 import は
`.oxlintrc.json` (層ごとの `no-restricted-imports` + `import/no-nodejs-modules`) で機械的に
強制する。ここに書いているのは lint では表現できない「なぜそう設計したか」の意図のみ。

## 開発ワークフロー

- テスト先行 (TDD)。domain は unit、commands は tmpdir 実 git repo での integration
- integration test は GIT_CONFIG_NOSYSTEM=1 / GIT_CONFIG_GLOBAL=/dev/null / HOME 隔離 / hooks 無効 / LC_ALL=C
- 検証コマンド:

```bash
bun test              # 全テスト
bun run typecheck     # tsc --noEmit
bun run lint          # oxlint
bun run format:check  # oxfmt --check
```

- external worktree (agent が作ったもの) を mutation の対象にしない、が最重要の安全規則。
  破壊操作に関わる変更では必ず docs/design.md の「worktree の 3 分類」「CLI 契約」を再読すること。

## Working Rules

- 複数段階の作業は、実装前に変更対象と検証方法を明確にする
- 変更後は触った範囲に対応する検証コマンドを実行し、結果を共有する
- commit 前に secrets、権限、入力境界の扱いを見直す
- コミットメッセージは conventional commits (feat/fix/refactor/docs/test/chore/ci)

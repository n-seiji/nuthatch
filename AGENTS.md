# AGENTS.md

この repo で作業する coding agent (Claude Code / Codex 等) 向けガイド。

## Repository Overview

`nuthatch` — git worktree manager。ユーザーが使うコマンド名は `hop`。
設計の正本は [docs/design.md](docs/design.md)。実装前に必ず読むこと。

## ディレクトリ構成と責務

```
src/                 # 実装 (TypeScript, bun)
docs/design.md       # 設計書 (source of truth)
plugins/hop/         # 公開 plugin (Claude Code / Codex 両対応)。hop の使い方 skill を配布
.claude/rules/       # 開発専用 rule (この repo の開発時のみ使う。配布しない)
.claude-plugin/      # Claude Code marketplace index
.agents/plugins/     # Codex marketplace index
shell/               # hop init zsh のテンプレート
test/                # unit (domain) + integration (実 git repo)
```

- **公開 skill** は `plugins/hop/skills/` に置く。Claude Code と Codex の両方から
  install できる形式 (`.claude-plugin/plugin.json` + `.codex-plugin/plugin.json`) を保つ。
- **開発専用 rule / skill** は `.claude/` 配下。配布物に含めない。

## アーキテクチャ制約 (違反 PR は reject)

- 依存方向は一方向のみ: `cli.ts → commands → domain + infra`
- `domain/` は純関数のみ。外部依存 (subprocess / fs / TTY / clock / random) を import しない
- `infra/` 以外で subprocess / fs を直接呼ばない。git は常に argv 配列で spawn (文字列連結禁止)
- `commands/` は相互 import 禁止。描画せず構造化 Result を返す
- subprocess は `node:child_process` (npm 版 Node / compile 版 Bun 両対応のため)
- CLI 契約 (stdout / JSON schema / exit code) は docs/design.md の定義に従い、変更は設計書の更新とセットで行う

## 開発ワークフロー

- テスト先行 (TDD)。domain は unit、commands は tmpdir 実 git repo での integration
- integration test は GIT_CONFIG_NOSYSTEM=1 / GIT_CONFIG_GLOBAL=/dev/null / HOME 隔離 / hooks 無効 / LC_ALL=C
- 検証コマンド:

```bash
bun test              # 全テスト
bun run typecheck     # tsc --noEmit
bun run lint          # biome
```

- external worktree (agent が作ったもの) を mutation の対象にしない、が最重要の安全規則。
  破壊操作に関わる変更では必ず docs/design.md の「worktree の 3 分類」「CLI 契約」を再読すること。

## Working Rules

- 複数段階の作業は、実装前に変更対象と検証方法を明確にする
- 変更後は触った範囲に対応する検証コマンドを実行し、結果を共有する
- commit 前に secrets、権限、入力境界の扱いを見直す
- コミットメッセージは conventional commits (feat/fix/refactor/docs/test/chore/ci)

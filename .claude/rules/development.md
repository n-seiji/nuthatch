# nuthatch 開発 rule (開発専用・配布しない)

- 設計の正本は docs/design.md。CLI 契約 (stdout / JSON schema / exit code) の変更は設計書更新とセット
- 依存方向 (オニオン): cli/render → commands → infra → domain (commands は infra/domain どちらにも依存可)。
  domain を最内層 (純関数のみ、node 組み込みも禁止) にするのは、CLI 構成が変わっても判定ロジックを
  単体でテストし続けられるようにするため
- commands は描画しない (構造化 Result を返す)。出力形式の変更が判定ロジックに波及しないようにするため
- subprocess は node:child_process、常に argv 配列。infra/ 以外で外部依存を触らない
- テスト先行。integration は tmpdir 実 repo + GIT_CONFIG_NOSYSTEM=1 / HOME 隔離 / LC_ALL=C
- テストは実装ファイルと同階層に colocate する (`src/domain/porcelain.ts` → `src/domain/porcelain.test.ts`)。共有 helper は `src/testing/`
- mutation (create/rm/clean/root切替) は repo lock 内で「再検証 → 実行」
- hop は誰が作った worktree でも (managed / external 問わず) rm・root 入れ替えの対象にする方針。
  安全弁は「dirty は拒否 (`--force` で上書き可)」「git-locked は `--force` でも常に拒否 (lock は外さない)」
  「picker/Ctrl+X からの external 削除は y/N 必須」「`hop clean` の自動候補は managed のみ」の 4 点
  (最重要安全規則)
- 上記の依存方向・any 禁止・console 直書き禁止・循環 import・commands 相互 import は oxlint
  (.oxlintrc.json の層ごとの no-restricted-imports + import/no-nodejs-modules) で機械的に強制する。
  ここには lint で表現できない設計意図のみ書く

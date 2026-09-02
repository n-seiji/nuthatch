# nuthatch 開発 rule (開発専用・配布しない)

- 設計の正本は docs/design.md。CLI 契約 (stdout / JSON schema / exit code) の変更は設計書更新とセット
- 依存方向: cli → commands → domain + infra。domain は純関数のみ
- commands は描画しない (構造化 Result を返す)。相互 import 禁止
- subprocess は node:child_process、常に argv 配列。infra/ 以外で外部依存を触らない
- テスト先行。integration は tmpdir 実 repo + GIT_CONFIG_NOSYSTEM=1 / HOME 隔離 / LC_ALL=C
- テストは実装ファイルと同階層に colocate する (`src/domain/porcelain.ts` → `src/domain/porcelain.test.ts`)。共有 helper は `src/testing/`
- mutation (create/rm/clean/root切替) は repo lock 内で「再検証 → 実行」
- external worktree をデフォルトの mutation 対象にしない (最重要安全規則)
- 機械的に検査可能な項目 (any 禁止、console 直書き禁止、循環 import、commands 相互 import 等) は oxlint (.oxlintrc.json) で強制する。ここには lint で表現できない設計意図のみ書く

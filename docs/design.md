# nuthatch 設計書

git worktree manager。コマンド名は `hop` (パッケージ名は nuthatch)。
固定 slot 制の旧 bash 版 wt を捨て、状態ファイルを持たない create-or-jump 型として作り直す。

## 設計原則

| 原則 | 内容 |
|---|---|
| zero setup | 状態ファイル・初期化コマンドなし。`git worktree list --porcelain` が唯一の正本。任意のリポジトリで即動く |
| convention over config | 置き場所は規約で固定 (ghq 流)。場所が決まっているから一覧も推測も速い |
| ai-native | 全コマンド非対話で完結。`--json` あり。path は stdout、ログは stderr。エラーは次の一手を含む |
| fast list | porcelain 1 回 + 詳細 (dirty / ahead-behind) のみ並列取得 |

## ディレクトリ規約

```
~/ghq/github.com/<user>/<repo>                      # root clone (動作確認専用)
~/ghq/github.com/<user>/_worktree/<repo>/<branch>   # worktree (branch ごと)
```

- slot 番号は無し。**1 branch = 1 worktree = 1 dir**。上限なし。
- dir 名は branch 名を sanitize したもの。`/` は `__` に変換
  (`-` だと `feat/foo` と `feat-foo` が衝突するため)。
  case-insensitive FS / 長大パス / 既存 dir との衝突時は末尾に short hash。
- Claude Code / Codex 等が独自の場所に作った worktree も `git worktree list`
  経由で発見し、一覧・移動の対象にする (external 扱い、後述)。

## コマンド体系 — hop 一本

コマンドは `hop` 1 つ。予約サブコマンドは `ls / rm / clean / root / init` の
5 つだけで、branch 名と被る場合は `hop -- <branch>` でエスケープする
(全コマンド統一)。`eval "$(hop init zsh)"` が自動 cd 用 shell function を定義する。

### 移動

| コマンド | 動作 |
|---|---|
| `hop` | TTY: ink のピッカーで worktree / branch を選んで cd。worktree 未作成の branch (local/remote) も候補に出し、選べば作って cd。非 TTY: 一覧出力 |
| `hop <branch>` | **create-or-jump**。worktree があれば cd。なければ default branch から作って cd。新規作成時は TTY なら確認、非 TTY では `--create` 必須 (typo 誤作成防止) |
| `hop root` | root clone へ cd |
| `hop -` | 直前にいた worktree へ戻る |

### 管理

| コマンド | 動作 |
|---|---|
| `hop ls [--json]` | 一覧。branch / path / 分類 / dirty / ahead-behind |
| `hop rm <branch>` | worktree を削除 (branch は残す)。dirty (untracked 含む) は拒否、`--force` で強制。external は `--ext --force` の二重ガード |
| `hop clean [--yes\|--dry-run]` | ゴミ worktree を自動判定して削除 (下記) |
| `hop root <branch>` | 動作確認用に root を一時切替。`hop root -` で復帰 (git の `@{-1}` 利用、状態ファイル不要) |

## worktree の 3 分類

| 分類 | 定義 | できること |
|---|---|---|
| root | 本体 clone | cd / `hop root <branch>` での一時切替のみ。編集作業はしない |
| managed | `_worktree/<repo>/` 配下 (nuthatch が作成) | cd / rm / clean すべて可 |
| external | それ以外 (Claude Code の EnterWorktree、Codex 等) | cd / 一覧 / jump は可。削除・切替は `--ext` 明示時のみ |

**安全規則 (最重要):**「見える・移動できる」と「nuthatch が変更権を持つ」を
分離する。external への jump は常に可能だが、mutation がデフォルトで external
に触れると agent の作業場所を破壊する。分類判定は realpath + パス境界で行い、
文字列 prefix 比較はしない。

## hop clean — ゴミ判定

1 つでも失うものがある worktree は候補にしない。

| 判定 | 条件 |
|---|---|
| prunable | git が prunable と報告 (worktree の候補化は無条件。branch の安全性は別途判定) |
| merged | branch が origin/HEAD (なければ main/master) に merge 済み、かつ clean |
| gone | upstream が `[gone]`、かつ origin/HEAD から到達不能な commit がない、かつ clean。判定不能なら削除拒否 |

- 対象は managed のみ。external は `--ext` 明示時のみ。
- TTY: 候補一覧 (branch / 理由 / path) を提示して一括確認。
  非 TTY: `--dry-run` が JSON で候補を返し、`--yes` で実行。
- `--with-branch` で branch ごと削除 (merged/gone 判定済みの場合のみ)。
  prunable は worktree が消えているため、branch の merged/gone 判定が別途成立しなければ
  worktree だけ削除して branch は残し、理由を warning として stderr に出す。

## hop root — 動作確認セッション

docker 等で root clone でしか動作確認できないケース向け。

- root が dirty (untracked 含む) なら切替拒否。
- 対象 branch を他 worktree が checkout 済みなら **swap せず拒否**して
  その path を案内 (自動 swap は agent 並走時に危険なため廃止)。
- 復帰は git の `@{-1}` に委ねる。失敗時は rollback。

## CLI 契約 (仕様として固定)

- **stdout**: cd 系成功時は path のみ (改行を含む path は非対応と明記)。
  一覧は表 or JSON。ログ・警告・ピッカーは常に stderr。
- **JSON**: 全コマンド `{schemaVersion, command, data, warnings}`。
  schema は snapshot テストで後方互換を固定。
- **exit code**: 0=成功 / 1=一般エラー / 2=使い方誤り / 3=安全拒否 (dirty 等) /
  130=picker キャンセル・SIGINT。shell wrapper は exit code を保持し成功時のみ cd。
- **mutation の排他**: 全 mutation (create / rm / clean / root 切替) は repo 単位の
  プロセス間 lock 内で「再検証 → 実行」する。lock は git common dir 配下に mkdir で
  作成し、PID・開始時刻・token を記録、保持中は heartbeat で更新。回収は
  プロセス生存確認 + 期限の両方を満たす場合のみ。確認不能なら安全側で拒否。
- **git 実行**: 常に argv 配列で spawn (文字列連結禁止)。git の失敗は exit 3 に写像。
- **remote branch からの作成**: origin に同名があれば常に origin。origin に無く
  複数 remote に同名があれば曖昧エラー。作成 branch は `--track`。

## アーキテクチャ — 疎結合・コンポーネント志向

ports & adapters (hexagonal) を軽量に適用。外部依存 (git subprocess / fs / TTY)
はすべて `infra/` に隔離し、ドメインロジックは純関数として外部依存ゼロ。

```
src/
├── cli.ts               # エントリ。citty で parse → command 実行 → 結果を描画
├── domain/              # 純関数のみ。import できるのは domain 内だけ
│   ├── model.ts         #   Worktree 型 (kind: root|managed|external)
│   ├── porcelain.ts     #   worktree list --porcelain parser
│   ├── sanitize.ts      #   branch名 → dir名
│   ├── classify.ts      #   root/managed/external 分類
│   └── garbage.ts       #   clean のゴミ判定 (clock は注入)
├── infra/               # 外部依存はここだけ。domain の port を実装
│   ├── git.ts           #   node:child_process execFile (argv 配列のみ)
│   ├── fs.ts            #   exists / realpath
│   └── term.ts          #   TTY 判定・stderr ログ
├── commands/            # 1 コマンド = 1 コンポーネント。相互 import 禁止
│   ├── jump.ts / ls.ts / rm.ts / clean.ts / root.ts / init.ts
│   │                    #   ★ 描画しない。構造化 Result を return するだけ
├── ui/picker.tsx        # ink。TTY のときだけ dynamic import (リテラル指定)
└── render.ts            # cli.ts 専用: Result → plain / JSON。commands からは import しない
shell/init.zsh           # hop init zsh のテンプレート (quote 厳密・冪等)
test/                    # domain は unit、commands は実 git repo で integration
```

- **依存方向は一方向**: cli → commands → domain + infra。domain は何にも依存しない。
- **commands は描画しない**: 構造化 Result を返し、cli.ts + render.ts が描画
  (出力共有モジュールは横断依存になるため置かない)。
- arg parser は **citty**。parser 固有の型を commands に流さない。
- subprocess は **node:child_process** — npm 版 (Node 20+) と
  compile 版 (Bun) の両方で動く。

## 実装スタック

| 項目 | 選定 | 補足 |
|---|---|---|
| 言語 | TypeScript | 開発ランタイムは bun |
| 最低バージョン | git >= 2.36 / node >= 20 / bun >= 1.1 | porcelain -z と compile の対応範囲 |
| TUI | ink | TTY のみ dynamic import。compile 同梱を実物検証、不可なら番号選択 fallback |
| arg parser | citty | 自作禁止 |
| lint/format | biome | |
| テスト | bun test | unit (domain) + integration (tmpdir 実 repo、GIT_CONFIG_NOSYSTEM=1 / HOME 隔離 / hooks 無効 / LC_ALL=C / clock 注入) |
| 配布 | npm + GitHub Releases | npm 版は bun build で dist/ に Node 実行可能 bundle。バイナリは bun compile (darwin-arm64/x64, linux-x64) |

## リリース手順 (順序固定)

build → `npm pack` → npm 版 + 全 OS バイナリの smoke test → npm publish
(--access public, provenance) → Releases 添付。**publish は最後** (壊れた版の公開防止)。

## インストール (公開後)

```sh
npm i -g @n-seiji/nuthatch          # npm / bun
mise use -g npm:@n-seiji/nuthatch   # mise
curl -fsSL https://raw.githubusercontent.com/n-seiji/nuthatch/main/install.sh | sh  # バイナリ
```

shell 統合は `.zshrc` に `eval "$(hop init zsh)"` の 1 行 (starship / zoxide と同方式)。

## 経緯

- 旧実装: dotfiles の bash 製 `wt` (固定 10 slot)。問題: slot 上限、`wt list` が
  逐次 git 実行で重い、agent が作る worktree と統合できない、dirty 判定が
  untracked を見落とす。
- 設計レビュー: codex gpt-5.6-sol と複数ラウンド実施済み
  (external 保護、TOCTOU/lock、gone 判定、npm/Bun 両立、リリース順序など反映)。

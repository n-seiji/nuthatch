[English](README.md)

<p align="center">
  <img src="docs/assets/logo.png" alt="nuthatch — hop between git worktrees" width="560">
</p>

<p align="center"><em>ナットハッチが木々を渡るように、git worktree 間を hop する。</em></p>

`nuthatch` は zero-setup な git worktree manager。単一コマンド **`hop`** が、
任意の branch の worktree へジャンプする — 存在しなければその場で作成する。
人間 (対話的 picker) と AI coding agent (非対話、`--json`) の両方に対応。

## なぜ

- **Zero setup** — 状態ファイルなし、init コマンドなし。
  `git worktree list --porcelain` が唯一の正本。任意のリポジトリで即動く。
- **Convention over config** — worktree は常に
  `<root の親>/_worktree/<repo>/<branch>` に置かれるため、一覧やパスの推測が
  速く予測可能。
- **AI native** — 全コマンドが非対話で完結し、`--json` はどこでも使え、path
  は stdout・ログは stderr に出て、エラーは次の一手を教えてくれる。

## 使い方

```sh
hop                # worktree/branch を対話的に選んで cd
hop feat/foo       # feat/foo の worktree へ cd — 未作成ならその場で作成
hop root           # root clone へ cd
hop -              # 直前の worktree へ戻る

hop ls [--json]    # worktree 一覧 (dirty, ahead/behind, kind)
hop rm <branch>    # worktree を削除 (branch は残す) — managed/external 問わず、dirty には --force が必要
hop clean          # ゴミ worktree を自動判定して削除 (managed のみ)
hop root <branch>  # root clone を一時的に切替 (動作確認用) —
                   # 対象 branch が他所で checkout 済みなら、clean かつ unlocked な holder を swap する
hop root -         # root clone を元に戻す (root の branch のみ; swap で detach した holder はそのまま)

hop -- <branch>    # 予約コマンドと被る branch 名をエスケープ
hop --help         # usage を表示 (-h / hop help でも同じ)
```

### 対話的 picker

picker は候補を section に分けて表示する — 既存の worktree (root が先頭) と
未作成の branch — ステータスマーカー・整列した列・短縮パス付きで:

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

candidate が 0 件になった section は (header ごと) 丸ごと消える —
検索クエリで絞り込んだ結果 0 件になった場合も同様。

各 section 内の順序は insertion 順ではなく固定: WORKTREES は root が先頭、
次に managed、その次に external (各グループ内は branch 名昇順、detached
HEAD の worktree はグループ内最後); BRANCHES は remote より local が先
(各グループ内は branch 名昇順)。これは検索フィルタ中も保たれる —
絞り込んでも残った項目の並びは変わらない。BRANCHES の行は dim 表示になり、
○/●/+ マーカーに加えて「既に worktree」か「まだ未作成」かが一目でわかる。

picker は terminal の alternate screen buffer (fzf や vim と同じ仕組み) で
動くため、scrollback 履歴に残らない — 実行のたびに画面を上書きし、
どう終了しても (選択、Esc/Ctrl-C、割り込み) shell の画面をきれいに復元する。

### 対話的 picker のキー

action panel は候補一覧の隣に列として表示される (overlay ではない) ので、
action を選ぶ間も一覧が見え続ける。60 列未満の terminal では横に並べられ
ないため、一覧の下にスタックする形にフォールバックする。

| キー | 動作 |
|---|---|
| `Enter` | 選択中の候補へ cd |
| `Tab`, `→`, `Ctrl+L`, `Ctrl+F` | 選択中の候補の action panel を開く (ここで cd / 削除 / root 切替) |
| `Ctrl+X` | 選択中の worktree を削除 (`external` は先に y/N を確認) |
| `Ctrl+R` | root clone を選択中の branch へ切替 (`external` は先に y/N を確認) |
| `↑`/`↓`, `Ctrl+P`/`Ctrl+N`, `Ctrl+K`/`Ctrl+J` | 選択を移動 (矢印・emacs・vim キーがすべて併用可) |
| `Esc` | 静かにキャンセル — exit 0、stdout は空のまま (shell wrapper は cd しない) |
| `Ctrl+C` | 割り込みとしてキャンセル — exit 130、実際の SIGINT と同じ |

action panel 内: 同じ上下移動キー (左右は閉じる操作に予約されており、
移動としては使われない)、`Enter` でハイライト中の action を実行、
`c`/`d`/`r` で cd/delete/switch-root を直接実行、`Esc`、`Tab`、`←`、
`Ctrl+H` で一覧に戻る (`←`/`Ctrl+H` は開く操作の `→`/`Ctrl+L`/`Ctrl+F` と
対になっている; `Tab` はどちらの状態からでもトグルする — Ghostty のように
Cmd+K のようなキーの組み合わせを Tab に remap する terminal で便利)。
`delete` はすでに作成済みの worktree (`managed` / `external`) すべてに
表示される (`external` の削除は panel からでも Ctrl+X からでも必ず y/N
を確認する); `switch root here` は root worktree 自身には表示されず、
`external` worktree に対しては HEAD を detach する可能性があるため
同じく先に y/N を確認する。削除すると候補一覧が再読み込みされ、picker を
抜けずに削除を続けられる; cd と switch-root は終了して結果の path を
出力する (hop の stdout 契約どおり)。

Shell 統合 (自動 `cd`):

```sh
# ~/.zshrc
eval "$(hop init zsh)"
```

## Install

> まだリリースされていない — バージョンは publish も tag もされていない。
> 最初の `v*` tag が出た後は、以下の選択肢が記載どおりに動く。

推奨: GitHub Release のバイナリ (bun 製、mise なら
`mise use github:n-seiji/nuthatch`)。npm 版は Node で動くため git 呼び出しが遅い
(hop ls ~400ms vs ~60ms) — CI や頻繁な呼び出しにはバイナリを使う。

```sh
# ビルド済みバイナリ (macOS arm64/x64, Linux x64) — Node.js 不要、最速:
curl -fsSL https://raw.githubusercontent.com/n-seiji/nuthatch/main/install.sh | sh
mise use github:n-seiji/nuthatch # mise、GitHub Release のバイナリ経由

# npm (低速: Node 経由で git を呼ぶ — バイナリの hop ls ~60ms に対し ~400ms)
npm i -g @n-seiji/nuthatch        # または: bunx @n-seiji/nuthatch
mise use -g npm:@n-seiji/nuthatch # mise、npm 経由
```

install script は `hop` を `~/.local/bin` に置き (`HOP_INSTALL_DIR` で
上書き可)、常に最新の GitHub Release を取得する; 特定バージョンに固定する
には `HOP_VERSION=vX.Y.Z` を使う。Linux arm64 はビルド済みバイナリが
まだないため、npm install を使う。

## Agent skill (Claude Code / Codex plugin)

このリポジトリは plugin marketplace も兼ねており、
[`using-hop`](skills/using-hop/SKILL.md) skill を配布する —
coding agent に `hop` を非対話・安全に扱う方法を教える skill。

```sh
# Claude Code
/plugin marketplace add n-seiji/nuthatch
/plugin install hop@nuthatch

# Codex
codex plugin marketplace add n-seiji/nuthatch
codex plugin install hop
```

## Docs

- [docs/design.md](docs/design.md) — 設計書 (全文)
- [AGENTS.md](AGENTS.md) — このリポジトリで作業する coding agent 向けガイド

## License

GPL-3.0 — [LICENSE](LICENSE) 参照。

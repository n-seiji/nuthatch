---
name: using-hop
description: git worktree manager「hop」(nuthatch) を coding agent から扱う。branch ごとの worktree への移動・作成・削除・一覧を非対話で行い、root clone を保護する運用を支える。
---

# using-hop — coding agent 向け hop の使い方

`hop` は git worktree manager。**1 branch = 1 worktree** で、
`<root clone の親>/_worktree/<repo>/<branch>` に worktree を置く。
root clone (本体) は動作確認専用で、コード変更は worktree 側で行う。

## Agent の基本フロー

Coding agent は shell の cd を保持できないため、path を受けて `git -C` で作業する。

```bash
path=$(hop feat/my-task --create)   # create-or-jump: あれば path、なければ作って path
git -C "$path" status --short
# … 編集・テスト・commit・push …
hop rm feat/my-task                 # 自分が作った worktree のみ片付ける
```

## コマンド一覧 (非対話)

| コマンド | 動作 |
|---|---|
| `hop <branch> --create` | worktree があれば path を返す。なければ default branch から作成して path を返す。`--create` なしで未存在なら安全拒否 (exit 3) |
| `hop root` | root clone の path |
| `hop ls --json` | 全 worktree の JSON 一覧 (`{schemaVersion, command, data, warnings}`)。kind (root/managed/external)・dirty・ahead/behind を含む |
| `hop rm <branch>` | worktree 削除 (branch は残る)。dirty なら拒否 (`--force` で強制)。external は `--ext --force` の両方が必要 |
| `hop clean --dry-run` | ゴミ worktree 候補 (prunable / merged / gone) を JSON で返す。`--yes` で削除実行。`--with-branch` は merged/gone が確認できた branch のみ削除 (未確認の branch は残る) |
| `hop root <branch>` / `hop root -` | root clone を一時的に切替 / 復帰 (動作確認用) |
| `hop -- <branch>` | branch 名が予約語 (ls/rm/clean/root/init) と被るときのエスケープ |

- stdout: path または JSON のみ。ログは stderr。
- exit code: 0=成功 (picker の ESC キャンセル含む) / 1=一般エラー / 2=使い方誤り / 3=安全拒否 (dirty 等) / 130=SIGINT 中断
- `hop --help` で全コマンド・フラグの usage を stderr に表示 (exit 0)

## 運用ルール

1. **root clone では編集しない**。編集・テストは worktree 側で行う。
2. viewer / picker 前提で使わない。branch は常に引数で明示する。
3. 他 agent や人間の worktree (kind=external、または自分が作っていない managed) を
   rm / clean しない。cleanup は自分が作ったものだけ。
4. 同じ branch を複数 agent で共有しない。unique な branch 名を使う。
5. dirty 拒否 (exit 3) に遭ったら commit / stash を先に行う。`--force` を安易に使わない。
6. root の一時切替 (`hop root <branch>`) を使ったら、作業後に必ず `hop root -` で戻す。

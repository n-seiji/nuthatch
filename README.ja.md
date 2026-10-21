<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/wordmark-dark.svg">
  <img src="docs/assets/wordmark-light.svg" alt="nuthatch" width="320">
</picture>

[English](README.md) · **日本語**

**git worktree を、作る・移る・消す。ぜんぶ `hop` ひとつで。**

`nuthatch` は、人間と AI coding agent のための zero-setup な git worktree manager。コマンドは `hop` ひとつで、設定も状態ファイルもいらない。[Web サイト](https://www.sijis.me/projects/nuthatch)

<table>
  <tr>
    <td align="center" valign="top" width="33%">
      <img src="docs/assets/tile-create.svg" width="200" alt="worktree を作る"><br>
      <b>作る</b><br>
      <sub>branch も worktree も、その場で。</sub>
    </td>
    <td align="center" valign="top" width="33%">
      <img src="docs/assets/tile-jump.svg" width="200" alt="worktree へ移る"><br>
      <b>移る</b><br>
      <sub><code>hop</code> で選び、<code>hop -</code> で戻る。</sub>
    </td>
    <td align="center" valign="top" width="33%">
      <img src="docs/assets/tile-remove.svg" width="200" alt="worktree を消す"><br>
      <b>消す</b><br>
      <sub>1 つずつ、または merge 済みをまとめて。</sub>
    </td>
  </tr>
</table>

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/n-seiji/nuthatch/main/install.sh | sh
```

続けて `~/.zshrc` に次を足すと、`hop` が `cd` までしてくれる。

```sh
eval "$(hop init zsh)"
```

npm、mise、Linux arm64、バイナリの検証、更新については [ガイド](docs/guide.ja.md#install) を参照。

## 使い方

| コマンド | 動作 |
|---|---|
| `hop` | worktree/branch を対話的に選んで `cd` |
| `hop <branch>` | その branch の worktree へ `cd` |
| `hop <branch> --create` | 未作成ならその場で worktree を作成 |
| `hop -` | 直前の worktree へ戻る |
| `hop root` | root clone へ `cd` |
| `hop ls [--json]` | worktree 一覧 (dirty, ahead/behind, kind) |
| `hop rm <branch>` | worktree を削除 (branch は残す) |
| `hop clean` | ゴミ worktree を自動判定して削除 (managed のみ) |
| `hop --update` | standalone バイナリを最新リリースへ置換 |

picker とそのキー、`hop root <branch>` などは [ガイド](docs/guide.ja.md#使い方) にある。

## 安全がデフォルト

- dirty な worktree は、`--force` を付けない限り拒否する。
- git が locked と報告する worktree は、`--force` でも削除しない。
- `_worktree` の外にある (external) worktree を picker から削除するときは y/N を確認する。Ctrl+X は常に確認する。
- `hop clean` が削除するのは、hop が管理する worktree だけ。
- `hop rm` は branch を残す。

## AI coding agent 向け

全コマンドが非対話で完結する。`--json` はどこでも使え、path は stdout、ログは stderr に出る。このリポジトリは [`using-hop`](skills/using-hop/SKILL.md) skill を plugin として配布している。

```sh
# Claude Code
/plugin marketplace add n-seiji/nuthatch
/plugin install hop@nuthatch

# Codex
codex plugin marketplace add n-seiji/nuthatch
codex plugin install hop
```

## More

- [Web サイト](https://www.sijis.me/projects/nuthatch)
- [ガイド](docs/guide.ja.md): 使い方、picker、インストール、更新、トラブルシューティング
- [docs/design.md](docs/design.md): 設計書
- [AGENTS.md](AGENTS.md): このリポジトリで作業する coding agent 向けガイド
- [LICENSE](LICENSE): GPL-3.0

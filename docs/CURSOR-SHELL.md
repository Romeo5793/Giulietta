# Cursor / エージェントでシェルが動かないとき

## いま起きていたこと

このセッションでは、エージェントの Shell ツールが **出力を返せない** 状態でした。  
また、ワークスペースが `Desktop\giulietta-service` を指している一方、実プロジェクトは次にあります。

**正しいパス:** `C:\Users\user\Documents\Cursor\giulietta-service`

`git.defaultCloneDirectory` は既に `Documents\Cursor` になっているので、**フォルダを開き直す**のが第一歩です。

---

## 手順（おすすめ順）

### 1. 正しいフォルダを開く

1. Cursor で **File → Open Folder**
2. `C:\Users\user\Documents\Cursor\giulietta-service` を選択
3. **Developer: Reload Window**（コマンドパレット）

デスクトップ側のショートカット／古いワークスペースは使わない。

### 2. Git for Windows を入れる（未導入なら）

エージェントは内部で `git.exe` を使います。無いと **ENOENT** で失敗することがあります。

- https://git-scm.com/download/win
- インストール後 Cursor を再起動
- ターミナルで `git --version` が通るか確認

### 3. エージェントの実行モード

**Settings → Cursor Settings → Agents → Approvals & Execution**

| 設定 | おすすめ |
|------|----------|
| Run Mode | **Auto-review**（標準） |
| サンドボックス | 有効のまま（安全） |

ネットワークが要るコマンド（`npm` / `npx` / `node` など）は、プロンプトが出たら **許可** するか、Allowlist に追加。

### 4. PowerShell のプロンプトを簡素化（任意）

Oh My Posh 等のリッチプロンプトは、エージェントの出力取得を壊すことがあります。

`$PROFILE`（例: `Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1`）に追加:

```powershell
if ($env:CURSOR_AGENT) {
  function prompt { "PS $($PWD.Name)> " }
}
```

### 5. 動作確認

統合ターミナル（Ctrl+`）で:

```powershell
echo SHELL_OK
git --version
node --version
```

エージェントに「`echo SHELL_OK` を実行して結果を教えて」と頼む。

---

## プロジェクト側の設定（済）

`.vscode/settings.json` でエージェント用ターミナルに **PowerShell（-NoLogo）** を指定済み。

---

## それでもダメなとき

1. Cursor を完全終了して再起動
2. ウイルス対策が `cursor.exe` / PowerShell の子プロセスをブロックしていないか確認
3. **Help → Report Issue** で「Agent shell returns empty output」と報告

シェルは Cursor 本体の制限・不具合のこともあるため、**100% settings.json だけで直るとは限りません**。上記 1〜2（正しいフォルダ + Git）が最も効きやすいです。

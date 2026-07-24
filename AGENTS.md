# AI / エージェント向けメモ

## このプロジェクトは何か

**Garage Log**（旧 **Giulietta Service**）— 全車種対応の整備手帳 + BLE OBD Web アプリ。

## ユーザーが「開きたい」「使いたい」と言ったとき

| 環境 | 参照 |
|------|------|
| **Mac** | [`docs/MAC-SETUP.md`](docs/MAC-SETUP.md) |
| **Windows** | [`docs/handoff.md`](docs/handoff.md) の「起動」 |
| 仕様・機能 | [`docs/SPEC.md`](docs/SPEC.md) |

### 起動の要点（どちらの OS も共通）

- ローカル HTTP サーバーが必要（`file://` 不可）
- URL: `http://127.0.0.1:5173`（ローカル） / **https://romeo5793.github.io/Giulietta/**（家族向け公開）
- ブラウザ: Chrome / Edge（OBD・BLE 用）

### Mac クイックコマンド

```bash
cd ~/Documents/Cursor/giulietta-service
python3 -m http.server 5173 --bind 127.0.0.1
```

初回: `git clone https://github.com/Romeo5793/Giulietta.git ~/Documents/Cursor/giulietta-service`

## リポジトリ

https://github.com/Romeo5793/Giulietta

# 引き継ぎ — Garage Log（旧 Giulietta Service）

最終更新: 2026-07-24

## いまの状態

- **正しいプロジェクト場所:** `C:\Users\user\Documents\Cursor\giulietta-service`
- デスクトップの `giulietta-service` は上記へのジャンクション（ショートカット用）
- 猫翻訳 `myapp` とは別リポジトリ
- Web アプリ名: **Garage Log**（全車種対応の整備手帳 + OBD）
- 機能: 複数車両 / 整備メニュー＋記録 / BLE OBD＋デモ / メーカー別 DTC 辞書 / 任意 Gemini
- 仕様: `docs/SPEC.md`
- OBD 調査資料: `docs/OBDアプリ開発用データ調査.docx`（要約: `docs/obd-research-extract.txt`）
- 旧 OBD ダッシュボード: `legacy/obd-dashboard.html`（参考用アーカイブ）

## 次にやること（候補）

1. 実車＋BLEアダプタで接続確認（クラシックBTのみだと不可）
2. 実車のオイル規格・ベルト交換歴を初期データに反映
3. 整備間隔を自分の手帳に合わせて調整UIを強化
4. Mac入手後に Flutter 等でアプリ化検討

## 起動

### Windows

```bash
cd C:\Users\user\Documents\Cursor\giulietta-service
npx --yes serve .
# または
py -m http.server 5173 --bind 127.0.0.1
```

Chrome / Edge で `http://127.0.0.1:5173` を開く。

### Mac（「giulietta service を使いたい」と言われたら）

**手順の正:** [`docs/MAC-SETUP.md`](MAC-SETUP.md)

```bash
cd ~/Documents/Cursor/giulietta-service   # 初回は git clone 先
python3 -m http.server 5173 --bind 127.0.0.1
```

Chrome / Edge で `http://127.0.0.1:5173` を開く。  
初回クローン: `git clone https://github.com/Romeo5793/Giulietta.git ~/Documents/Cursor/giulietta-service`

## Cursor で開くとき

- **Windows:** `C:\Users\user\Documents\Cursor\giulietta-service`（デスクトップのジャンクションでも可）
- **Mac:** `~/Documents/Cursor/giulietta-service`

エージェント向け索引: ルートの [`AGENTS.md`](../AGENTS.md)

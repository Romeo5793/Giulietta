# Mac で Giulietta Service（Garage Log）を開く

**このアプリの呼び名:** Garage Log（旧 Giulietta Service）  
**リポジトリ:** https://github.com/Romeo5793/Giulietta  
**種類:** ブラウザで動く Web アプリ（`index.html` を直接ダブルクリックでは開かない）

---

## ユーザーが「Mac で giulietta service を使いたい」と言ったとき

エージェントは次を実行・案内する。

### 1. 初回のみ — クローン

```bash
mkdir -p ~/Documents/Cursor
cd ~/Documents/Cursor
git clone https://github.com/Romeo5793/Giulietta.git giulietta-service
cd giulietta-service
```

既にクローン済みなら:

```bash
cd ~/Documents/Cursor/giulietta-service
git pull
```

### 2. ローカルサーバーを起動

```bash
cd ~/Documents/Cursor/giulietta-service
python3 -m http.server 5173 --bind 127.0.0.1
```

（Node.js がある場合は `npx --yes serve .` でも可）

### 3. ブラウザで開く

**Chrome** または **Edge** で次を開く:

**http://127.0.0.1:5173**

- OBD（BLE 接続）を使うときは **Safari ではなく Chrome / Edge** を使う
- プライベートウィンドウだと Bluetooth が使えないことがある

### 4. Cursor でプロジェクトを開く

**File → Open Folder** で `~/Documents/Cursor/giulietta-service` を選ぶ。

---

## よくある質問

| 質問 | 答え |
|------|------|
| Windows のデータは引き継がれる？ | いいえ。`localStorage` は端末ごと。未テストなら気にしなくてよい |
| 毎回サーバーが必要？ | はい。ターミナルで `python3 -m http.server ...` を実行したまま使う |
| ポート 5173 が使われている | `python3 -m http.server 8080 --bind 127.0.0.1` に変え、URL も `:8080` にする |
| アプリ名は？ | UI 上は **Garage Log**。フォルダ名は `giulietta-service` のまま |

---

## 実機 OBD テスト（Mac）

1. BLE 対応 ELM327 系アダプタを用意（クラシック BT のみは不可が多い）
2. アプリの **OBD** タブ → **BLE接続** または **デモ**
3. エンジン ON または ACC で VIN / DTC / ライブゲージを確認

詳細仕様: [`docs/SPEC.md`](SPEC.md)

---

## 関連ドキュメント

- 全体の引き継ぎ: [`docs/handoff.md`](handoff.md)
- Windows 環境: [`docs/CURSOR-SHELL.md`](CURSOR-SHELL.md)

# Garage Log

**全車種対応**の整備記録＋OBD Webアプリ。  
どんなメーカー・車種でも、走行距離ベースの整備リマインドと記録ができます。

方針の正は [`docs/SPEC.md`](docs/SPEC.md)。

## 主な機能

- 複数車両の登録・切替（無料版: 5台まで）
- エンジン種別テンプレート（NA / ターボ / ディーゼル / HV / EV / 軽）
- 整備メニュー・実施記録・期限表示
- BLE OBD-II（ELM327 系）接続・DTC・簡易メーター
- 任意 Gemini による DTC 参考アドバイス（重要度付き）
- **メーカー別 DTC 辞書**（設定のメーカー名で OEM → 汎用の順に検索）

## 使い方

```bash
# Node がある場合（Windows / Mac 共通）
npx --yes serve .

# Windows（Python）
py -m http.server 5173 --bind 127.0.0.1

# Mac
python3 -m http.server 5173 --bind 127.0.0.1
```

Chrome または Edge で `http://127.0.0.1:5173` を開く。

### 家族向け（HTTPS・インストール不要）

**https://romeo5793.github.io/Giulietta/**

- 手順の詳細: [`docs/FAMILY.md`](docs/FAMILY.md)
- `main` ブランチへ push すると GitHub Pages に自動反映されます

### Mac で初めて使うとき

```bash
git clone https://github.com/Romeo5793/Giulietta.git ~/Documents/Cursor/giulietta-service
cd ~/Documents/Cursor/giulietta-service
python3 -m http.server 5173 --bind 127.0.0.1
```

詳細: [`docs/MAC-SETUP.md`](docs/MAC-SETUP.md)（「Mac で giulietta service を使いたい」と言えばここを案内）

## OBD

- **対応**: OBD-II 規格の車（メーカー問わず）
- **アダプタ**: BLE 対応 ELM327 系
  - LELink / 汎用: サービス `FFE0`、キャラ `FFE1`
  - IOS-Vlink / OBDLink: サービス `E7810A71-...`、キャラ `BEF8D6C9-...`
  - その他 `FFF0` 系
- **非対応が多い**: クラシック Bluetooth（SPP）のみの安価ドングル

### DTC 辞書

- **汎用**: `data/dtc/generic.json`（約40コード）
- **OEM**: [Automotive-9/dtc-codes](https://github.com/Automotive-9/dtc-codes) 由来（**全10メーカー・31,272コード同梱**）
- **同梱ファイル**: `data/dtc/oem/*.json`（約6MB）
- ローカルファイルがない場合のみ GitHub CDN から取得（フォールバック）
- **再生成**:

```bash
node scripts/build-oem-dtc.mjs
# または Windows:
scripts\build-oem-dtc.cmd
```

設定の「メーカー」に `BMW` / `Ford` / `Alfa Romeo` などを入れると、対応データセットを自動選択します。

## データ

- ブラウザ `localStorage`（`garage-log-v2`）
- 旧 `giulietta-service-v1` データは初回起動時に自動移行

## 構成

```
index.html
css/style.css
js/
  app.js
  storage.js
  service-plan.js
  vehicle-templates.js
  obd.js
  dtc-dict.js
  dtc-loader.js
  gemini.js
data/dtc/
  generic.json
  manufacturers.json
  oem/          … メーカー別（Automotive-9 由来）
docs/SPEC.md
scripts/build-oem-dtc.mjs
```

## 販売に向けて（今後）

- 有料プラン（台数無制限・エクスポート・同期）
- Mac 上でのアプリ化（Flutter 等）
- 利用規約・免責の整備

現在はプロトタイプ段階。課金・認証は未実装です。

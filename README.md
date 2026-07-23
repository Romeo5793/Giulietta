# Giulietta Service

Alfa Romeo **Giulietta 1.4 コンペティツィオーネ MT** 向けの整備記録＋OBD Webアプリ。

方針の正は [`docs/SPEC.md`](docs/SPEC.md)。

## 使い方

1. このフォルダでローカルサーバを起動（Web Bluetooth は `file://` では動きません）

```bash
# Node がある場合
npx --yes serve .

# Node が無い場合（Windows）
py -m http.server 5173 --bind 127.0.0.1
```

2. Chrome または Edge で `http://127.0.0.1:5173` を開く（Windows / 後の Mac でも可）
3. **ホーム**で走行距離を入れる → **整備**で記録 → **OBD**でアダプタ接続

## OBDアダプタについて

ブラウザの Web Bluetooth は **BLE（Bluetooth Low Energy）** のみです。

- 使える例: BLE対応の ELM327 系（名前に OBD / ELM / Vgate など、サービス UUID `FFF0` / `FFE0`）
- **使えないことが多い**: 古い「クラシックBluetooth（SPP）」だけの安いドングル

接続できないときは **デモモード** で画面だけ確認できます。

iPhone の Safari は Web Bluetooth 非対応が多いです。当面は Android Chrome、または PC の Chrome / Edge を推奨。

## Gemini（任意）

設定に API キーを入れると、DTC 画面から「AIに聞く」が使えます。キーは端末の `localStorage` のみ。

## 構成

```
index.html
css/style.css
js/           app / storage / service-plan / obd / dtc-dict / gemini
docs/SPEC.md
```

## 参考

診断UIの発想は [Romeo5793/Giulietta](https://github.com/Romeo5793/Giulietta) を参考にしつつ、本アプリの幹は整備リマインドと記録です。

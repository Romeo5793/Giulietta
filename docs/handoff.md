# 引き継ぎ — Giulietta Service

最終更新: 2026-07-14

## いまの状態

- 新規フォルダ `C:\Users\user\Desktop\giulietta-service`（猫翻訳 `myapp` とは別）
- Web MVP: ホーム距離 / 整備メニュー＋記録 / BLE OBD＋デモ / DTC / 任意 Gemini
- 仕様: `docs/SPEC.md`

## 次にやること（候補）

1. 実車＋BLEアダプタで接続確認（クラシックBTのみだと不可）
2. 実車のオイル規格・ベルト交換歴を初期データに反映
3. 整備間隔を自分の手帳に合わせて調整UIを強化
4. Mac入手後に Flutter 等でアプリ化検討

## 起動

```bash
cd C:\Users\user\Desktop\giulietta-service
npx --yes serve .
```

Chrome / Edge で開く。

# DTC データ出典

- **汎用コード**: Garage Log 独自（SAE J2012 よく出るコード）
- **OEMコード**: [Automotive-9/dtc-codes](https://github.com/Automotive-9/dtc-codes)（MIT相当のオープンデータ集）
- **生成**: `scripts/build-oem-dtc.ps1` / `build-oem-dtc.mjs`

## 同梱メーカー（2026-07-24 ビルド）

| メーカー | コード数 | ファイル |
|----------|----------|----------|
| Alfa Romeo | 29 | oem/alfa-romeo.json |
| BMW | 4,781 | oem/bmw.json |
| Chrysler | 665 | oem/chrysler.json |
| Fiat | 246 | oem/fiat.json |
| Ford | 3,315 | oem/ford.json |
| GM | 5,325 | oem/gm.json |
| Honda | 367 | oem/honda.json |
| Mitsubishi | 3,998 | oem/mitsubishi.json |
| Nissan | 3,409 | oem/nissan.json |
| Volkswagen | 9,137 | oem/volkswagen.json |
| **合計** | **31,272** | |

重要度（severity）はビルド時にヒューリスティックで付与。診断の最終判断は整備工場にご相談ください。

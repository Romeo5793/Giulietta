/** MultiAir / Giulietta 向けの短い DTC 辞書（参考用） */
export const DTC_DICT = {
  P0300: {
    name: "Random/Multiple Misfire",
    desc: "複数気筒の失火。プラグ・コイル・燃料・吸気系を広く点検。",
  },
  P0301: { name: "Cylinder 1 Misfire", desc: "1番気筒失火。プラグ／コイルの優先点検。" },
  P0302: { name: "Cylinder 2 Misfire", desc: "2番気筒失火。プラグ／コイルの優先点検。" },
  P0303: { name: "Cylinder 3 Misfire", desc: "3番気筒失火。プラグ／コイルの優先点検。" },
  P0304: { name: "Cylinder 4 Misfire", desc: "4番気筒失火。プラグ／コイルの優先点検。" },
  P1061: {
    name: "MultiAir Solenoid Cyl 1",
    desc: "MultiAirソレノイド異常。オイル状態・粘度・スラッジも確認。",
  },
  P1062: {
    name: "MultiAir Solenoid Cyl 2",
    desc: "MultiAirソレノイド異常。オイル状態・粘度・スラッジも確認。",
  },
  P1063: {
    name: "MultiAir Solenoid Cyl 3",
    desc: "MultiAirソレノイド異常。オイル状態・粘度・スラッジも確認。",
  },
  P1064: {
    name: "MultiAir Solenoid Cyl 4",
    desc: "MultiAirソレノイド異常。オイル状態・粘度・スラッジも確認。",
  },
  P0236: { name: "Turbo Boost Sensor", desc: "ブーストセンサ／配管漏れの疑い。" },
  P0244: { name: "Turbo Wastegate", desc: "ウェイストゲート制御の疑い。" },
  P0171: { name: "System Too Lean", desc: "空燃比リーン。吸入漏れ・燃料・MAF系。" },
  P0172: { name: "System Too Rich", desc: "空燃比リッチ。燃料・センサ系。" },
};

export function lookupDtc(code) {
  return (
    DTC_DICT[code] || {
      name: "Unknown / 未登録",
      desc: "辞書外です。取説・専門ツール・整備工場と合わせて確認してください。",
    }
  );
}

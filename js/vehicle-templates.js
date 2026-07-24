/** 車種テンプレート — 初期整備メニュー（目安・車両ごとに編集可） */

const BASE_ITEMS = {
  oil: {
    id: "oil",
    name: "エンジンオイル＋フィルタ",
    intervalKm: 10000,
    intervalMonths: 12,
    note: "取扱説明書の規格・粘度に合わせてください。",
  },
  oilLong: {
    id: "oil",
    name: "エンジンオイル＋フィルタ",
    intervalKm: 15000,
    intervalMonths: 12,
    note: "ロングライフオイル仕様の場合は取説を優先。",
  },
  cabin: {
    id: "cabin-filter",
    name: "キャビンフィルタ",
    intervalKm: 15000,
    intervalMonths: 12,
    note: "",
  },
  air: {
    id: "air-filter",
    name: "エアフィルタ",
    intervalKm: 30000,
    intervalMonths: 36,
    note: "",
  },
  plugs: {
    id: "spark-plugs",
    name: "スパークプラグ",
    intervalKm: 60000,
    intervalMonths: 60,
    note: "イリジウムプラグは交換間隔が長い場合あり。",
  },
  brakeFluid: {
    id: "brake-fluid",
    name: "ブレーキフルード",
    intervalKm: null,
    intervalMonths: 24,
    note: "距離より年数優先が多い項目。",
  },
  coolant: {
    id: "coolant",
    name: "クーラント",
    intervalKm: 60000,
    intervalMonths: 60,
    note: "",
  },
  timingBelt: {
    id: "timing-belt",
    name: "タイミングベルト／チェーン点検",
    intervalKm: 100000,
    intervalMonths: 60,
    note: "チェーン式の場合は点検中心。取説・整備記録を正とする。",
  },
  transmission: {
    id: "transmission-fluid",
    name: "トランスミッションフルード",
    intervalKm: 60000,
    intervalMonths: 48,
    note: "AT/CVT/DCT など仕様により異なる。",
  },
  fuelFilter: {
    id: "fuel-filter",
    name: "燃料フィルタ",
    intervalKm: 40000,
    intervalMonths: 48,
    note: "",
  },
  dpf: {
    id: "dpf-service",
    name: "DPF関連点検",
    intervalKm: 20000,
    intervalMonths: 12,
    note: "ディーゼル車。走行パターンにより頻度が変わる。",
  },
  hybridBattery: {
    id: "hybrid-battery",
    name: "ハイブリッドバッテリー冷却液",
    intervalKm: null,
    intervalMonths: 120,
    note: "車種により要確認。",
  },
  evCoolant: {
    id: "ev-coolant",
    name: "バッテリー冷却液",
    intervalKm: null,
    intervalMonths: 60,
    note: "EVは車種ごとに交換間隔が異なる。",
  },
  tires: {
    id: "tire-rotation",
    name: "タイヤローテーション",
    intervalKm: 10000,
    intervalMonths: 12,
    note: "",
  },
  inspection: {
    id: "vehicle-inspection",
    name: "車検・法定点検",
    intervalKm: null,
    intervalMonths: 24,
    note: "日本の車検サイクルは初回・経過年数で変わる。",
  },
};

export const VEHICLE_TEMPLATES = [
  {
    id: "gasoline-na",
    label: "ガソリン（自然吸気）",
    description: "一般的な NA エンジン向けの基本セット",
    items: [
      BASE_ITEMS.oil,
      BASE_ITEMS.cabin,
      BASE_ITEMS.air,
      BASE_ITEMS.plugs,
      BASE_ITEMS.brakeFluid,
      BASE_ITEMS.coolant,
      BASE_ITEMS.tires,
      BASE_ITEMS.inspection,
    ],
  },
  {
    id: "gasoline-turbo",
    label: "ガソリン（ターボ）",
    description: "ターボ車向け。オイル管理を重視",
    items: [
      { ...BASE_ITEMS.oil, note: "ターボ車はオイル劣化が早い場合あり。取説の規格を厳守。" },
      BASE_ITEMS.cabin,
      BASE_ITEMS.air,
      BASE_ITEMS.plugs,
      BASE_ITEMS.brakeFluid,
      BASE_ITEMS.coolant,
      BASE_ITEMS.timingBelt,
      BASE_ITEMS.tires,
      BASE_ITEMS.inspection,
    ],
  },
  {
    id: "diesel",
    label: "ディーゼル",
    description: "DPF・燃料系を含むセット",
    items: [
      BASE_ITEMS.oilLong,
      BASE_ITEMS.cabin,
      BASE_ITEMS.air,
      BASE_ITEMS.fuelFilter,
      BASE_ITEMS.brakeFluid,
      BASE_ITEMS.coolant,
      BASE_ITEMS.dpf,
      BASE_ITEMS.tires,
      BASE_ITEMS.inspection,
    ],
  },
  {
    id: "hybrid",
    label: "ハイブリッド",
    description: "HV / PHEV 向け",
    items: [
      BASE_ITEMS.oilLong,
      BASE_ITEMS.cabin,
      BASE_ITEMS.air,
      BASE_ITEMS.brakeFluid,
      BASE_ITEMS.coolant,
      BASE_ITEMS.hybridBattery,
      BASE_ITEMS.tires,
      BASE_ITEMS.inspection,
    ],
  },
  {
    id: "ev",
    label: "電気自動車（EV）",
    description: "エンジンオイルなしの基本セット",
    items: [
      BASE_ITEMS.cabin,
      BASE_ITEMS.brakeFluid,
      BASE_ITEMS.evCoolant,
      BASE_ITEMS.tires,
      BASE_ITEMS.inspection,
    ],
  },
  {
    id: "kei",
    label: "軽自動車",
    description: "軽向けの短い間隔目安",
    items: [
      { ...BASE_ITEMS.oil, intervalKm: 5000, intervalMonths: 6 },
      BASE_ITEMS.cabin,
      { ...BASE_ITEMS.air, intervalKm: 20000, intervalMonths: 24 },
      BASE_ITEMS.brakeFluid,
      BASE_ITEMS.tires,
      BASE_ITEMS.inspection,
    ],
  },
  {
    id: "minimal",
    label: "最小セット",
    description: "オイルと車検だけから始める",
    items: [BASE_ITEMS.oil, BASE_ITEMS.inspection],
  },
];

export function getTemplate(templateId) {
  return VEHICLE_TEMPLATES.find((t) => t.id === templateId) || VEHICLE_TEMPLATES[0];
}

export function templateOptionsHtml(selectedId) {
  return VEHICLE_TEMPLATES.map(
    (t) => `<option value="${t.id}" ${t.id === selectedId ? "selected" : ""}>${t.label}</option>`
  ).join("");
}

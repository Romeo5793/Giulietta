/** 1.4 MultiAir Competizione 向けの初期整備メニュー（目安・編集可） */
export const DEFAULT_SERVICE_ITEMS = [
  {
    id: "oil",
    name: "エンジンオイル＋フィルタ",
    intervalKm: 10000,
    intervalMonths: 12,
    note: "MultiAirはオイル管理が重要。取説の規格に合う油を使用。",
  },
  {
    id: "cabin-filter",
    name: "キャビンフィルタ",
    intervalKm: 15000,
    intervalMonths: 12,
    note: "",
  },
  {
    id: "air-filter",
    name: "エアフィルタ",
    intervalKm: 30000,
    intervalMonths: 36,
    note: "",
  },
  {
    id: "spark-plugs",
    name: "スパークプラグ",
    intervalKm: 45000,
    intervalMonths: 48,
    note: "",
  },
  {
    id: "brake-fluid",
    name: "ブレーキフルード",
    intervalKm: null,
    intervalMonths: 24,
    note: "距離より年数優先が多い項目。",
  },
  {
    id: "coolant",
    name: "クーラント",
    intervalKm: 60000,
    intervalMonths: 60,
    note: "",
  },
  {
    id: "timing-belt",
    name: "タイミングベルト関連",
    intervalKm: 120000,
    intervalMonths: 60,
    note: "年式・仕様で異なる。ディーラー推奨を優先。",
  },
];

export function ensureDefaultItems(items) {
  if (items && items.length) return items;
  const now = new Date().toISOString().slice(0, 10);
  return DEFAULT_SERVICE_ITEMS.map((item) => ({
    ...item,
    lastDate: now,
    lastOdometerKm: 0,
  }));
}

function monthsBetween(fromIso, toDate = new Date()) {
  if (!fromIso) return 0;
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) return 0;
  const years = toDate.getFullYear() - from.getFullYear();
  const months = toDate.getMonth() - from.getMonth();
  const dayAdj = toDate.getDate() < from.getDate() ? -1 : 0;
  return years * 12 + months + dayAdj;
}

export function evaluateItem(item, odometerKm) {
  const kmLeft =
    item.intervalKm != null && item.lastOdometerKm != null
      ? item.intervalKm - (Number(odometerKm) - Number(item.lastOdometerKm || 0))
      : null;
  const monthsLeft =
    item.intervalMonths != null && item.lastDate
      ? item.intervalMonths - monthsBetween(item.lastDate)
      : null;

  let status = "ok";
  let summary = "余裕あり";

  const dueByKm = kmLeft != null && kmLeft <= 0;
  const dueByMonths = monthsLeft != null && monthsLeft <= 0;
  const soonByKm = kmLeft != null && kmLeft <= 1000;
  const soonByMonths = monthsLeft != null && monthsLeft <= 1;

  if (dueByKm || dueByMonths) {
    status = "due";
    summary = "期限到来";
  } else if (soonByKm || soonByMonths) {
    status = "warn";
    summary = "そろそろ";
  }

  return { status, summary, kmLeft, monthsLeft };
}

export function upcomingItems(items, odometerKm) {
  return [...items]
    .map((item) => ({ item, eval: evaluateItem(item, odometerKm) }))
    .sort((a, b) => {
      const rank = { due: 0, warn: 1, ok: 2 };
      const d = rank[a.eval.status] - rank[b.eval.status];
      if (d !== 0) return d;
      const ak = a.eval.kmLeft ?? 999999;
      const bk = b.eval.kmLeft ?? 999999;
      return ak - bk;
    });
}

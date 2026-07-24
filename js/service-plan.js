import { getTemplate } from "./vehicle-templates.js";

export function instantiateItems(templateItems, { lastDate, lastOdometerKm } = {}) {
  const today = lastDate || new Date().toISOString().slice(0, 10);
  const odo = lastOdometerKm ?? 0;
  return templateItems.map((item) => ({
    ...item,
    lastDate: today,
    lastOdometerKm: odo,
  }));
}

export function itemsFromTemplate(templateId, odometerKm = 0) {
  const template = getTemplate(templateId);
  return instantiateItems(template.items, { lastOdometerKm: odometerKm });
}

export function ensureDefaultItems(items, templateId = "gasoline-na") {
  if (items && items.length) return items;
  return itemsFromTemplate(templateId);
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

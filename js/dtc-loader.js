/** メーカー別 DTC 辞書の遅延読み込み（data/dtc/ + Automotive-9 CDN フォールバック） */

const CDN_BASE = "https://raw.githubusercontent.com/Automotive-9/dtc-codes/main";

const cache = {
  generic: null,
  manufacturers: null,
  oem: new Map(),
};

const UNKNOWN = {
  name: "未登録コード",
  desc: "車種・年式により意味が異なります。整備マニュアル・専門店と合わせて確認してください。",
  severity: 1,
  is_generic: null,
  source: "unknown",
};

export const SEVERITY_LABELS = ["情報", "軽度", "要整備", "即時確認"];

export function severityClass(level) {
  const n = Number(level);
  if (n >= 3) return "sev-3";
  if (n === 2) return "sev-2";
  if (n === 1) return "sev-1";
  return "sev-0";
}

function normalizeCode(code) {
  return String(code || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function normalizeMake(make) {
  return String(make || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function inferSeverity(code, desc) {
  const c = normalizeCode(code);
  const d = String(desc || "").toLowerCase();
  if (
    /shut.?off|safety cut|secure breakdown|irreversible|immediate stop|critical/i.test(
      d
    )
  ) {
    return 3;
  }
  if (
    c.startsWith("P03") ||
    c.startsWith("P06") ||
    /misfire|fuel rail|oil pressure|overheat|knock|no power|microprocessor fail/i.test(
      d
    )
  ) {
    return 2;
  }
  if (c.startsWith("U") || c.startsWith("C")) return 2;
  if (c.startsWith("B")) return 1;
  return 1;
}

function convertAutomotive9Raw(raw, manufacturer) {
  const codes = {};
  for (const [code, text] of Object.entries(raw)) {
    if (code === "manufacturer" || code === "version" || code === "count" || code === "codes") {
      continue;
    }
    const key = normalizeCode(code);
    const desc = String(text).trim();
    if (!key || !desc) continue;
    codes[key] = {
      name: desc.length > 72 ? `${desc.slice(0, 69)}…` : desc,
      desc,
      severity: inferSeverity(key, desc),
      is_generic: false,
      manufacturer,
    };
  }
  return codes;
}

function normalizeOemPayload(data, manufacturer) {
  if (data?.codes && typeof data.codes === "object") {
    return data.codes;
  }
  return convertAutomotive9Raw(data, manufacturer);
}

async function loadJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

async function loadManufacturersMeta() {
  if (cache.manufacturers) return cache.manufacturers;
  cache.manufacturers = await loadJson("./data/dtc/manufacturers.json");
  return cache.manufacturers;
}

async function loadGeneric() {
  if (cache.generic) return cache.generic;
  const data = await loadJson("./data/dtc/generic.json");
  cache.generic = data.codes || {};
  return cache.generic;
}

export async function resolveDatasetKeys(make) {
  const meta = await loadManufacturersMeta();
  const key = normalizeMake(make);
  if (!key) return [];
  return meta.aliases[key] || [];
}

async function loadOemDataset(datasetKey) {
  if (cache.oem.has(datasetKey)) return cache.oem.get(datasetKey);
  const meta = await loadManufacturersMeta();
  const info = meta.datasets[datasetKey];
  if (!info) return null;

  let codes = null;
  let source = "local";

  if (info.file) {
    try {
      const data = await loadJson(`./data/dtc/${info.file}`);
      codes = normalizeOemPayload(data, datasetKey);
    } catch {
      /* ローカル未同梱 → CDN */
    }
  }

  if (!codes && info.remote) {
    const data = await loadJson(`${CDN_BASE}/${info.remote}`);
    codes = normalizeOemPayload(data, datasetKey);
    source = "cdn";
  }

  if (!codes) return null;

  const pack = { codes, label: info.label || datasetKey, source };
  cache.oem.set(datasetKey, pack);
  return pack;
}

function guessSeverity(code) {
  const c = normalizeCode(code);
  if (c.startsWith("P03") || c.startsWith("P06")) return 2;
  if (c.startsWith("U") || c.startsWith("C")) return 2;
  if (c.startsWith("B")) return 1;
  return 1;
}

function entryFromRaw(raw, source) {
  if (!raw) return null;
  return {
    name: raw.name || raw.desc || "—",
    desc: raw.desc || raw.name || "",
    severity: raw.severity ?? 1,
    is_generic: raw.is_generic ?? source === "generic",
    source,
  };
}

/**
 * メーカー固有 → 汎用 → 未登録 の順で検索
 */
export async function lookupDtc(code, make) {
  const normalized = normalizeCode(code);
  if (!normalized) return { ...UNKNOWN };

  const datasetKeys = await resolveDatasetKeys(make);
  for (const key of datasetKeys) {
    try {
      const pack = await loadOemDataset(key);
      const hit = pack?.codes?.[normalized];
      if (hit) {
        return entryFromRaw(hit, `oem:${key}`);
      }
    } catch {
      /* ネットワーク不可時はスキップ */
    }
  }

  try {
    const generic = await loadGeneric();
    const hit = generic[normalized];
    if (hit) return entryFromRaw(hit, "generic");
  } catch {
    /* ignore */
  }

  return {
    ...UNKNOWN,
    severity: guessSeverity(normalized),
    source: "unknown",
  };
}

export async function getOemHintForMake(make) {
  const keys = await resolveDatasetKeys(make);
  if (!keys.length) return "汎用コードのみ";
  const meta = await loadManufacturersMeta();
  return keys.map((k) => meta.datasets[k]?.label || k).join(" → ");
}

export async function preloadDtcForMake(make) {
  const keys = await resolveDatasetKeys(make);
  await Promise.all([loadGeneric(), ...keys.map((k) => loadOemDataset(k))]);
}

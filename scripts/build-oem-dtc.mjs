/**
 * Automotive-9/dtc-codes から OEM DTC JSON を生成する。
 * 実行: node scripts/build-oem-dtc.mjs
 */
import { writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const BASE =
  "https://raw.githubusercontent.com/Automotive-9/dtc-codes/main";

const OEM_SOURCES = {
  "alfa-romeo": "AlfaRomeo.json",
  bmw: "BMW.json",
  chrysler: "Chrysler.json",
  fiat: "Fiat.json",
  ford: "Ford.json",
  gm: "GM.json",
  honda: "Honda.json",
  mitsubishi: "Mitsubishi.json",
  nissan: "Nissan.json",
  volkswagen: "Volkswagen.json",
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "data", "dtc", "oem");

function inferSeverity(code, desc) {
  const c = code.toUpperCase();
  const d = (desc || "").toLowerCase();
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

function convert(raw, manufacturer) {
  const codes = {};
  for (const [code, text] of Object.entries(raw)) {
    const key = code.toUpperCase();
    const desc = String(text).trim();
    codes[key] = {
      name: desc.length > 72 ? `${desc.slice(0, 69)}…` : desc,
      desc,
      severity: inferSeverity(key, desc),
      is_generic: false,
      manufacturer,
    };
  }
  return {
    manufacturer,
    version: "automotive-9",
    count: Object.keys(codes).length,
    codes,
  };
}

mkdirSync(OUT_DIR, { recursive: true });

let total = 0;
for (const [key, file] of Object.entries(OEM_SOURCES)) {
  const url = `${BASE}/${file}`;
  process.stdout.write(`Fetching ${file}… `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  const raw = await res.json();
  const out = convert(raw, key);
  writeFileSync(join(OUT_DIR, `${key}.json`), JSON.stringify(out));
  total += out.count;
  console.log(`${out.count} codes`);
}

console.log(`Done. ${total} OEM codes in ${OUT_DIR}`);

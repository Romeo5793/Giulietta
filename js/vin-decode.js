/** OBD Mode 09 PID 02 応答から VIN を抽出し、WMI からメーカー・年式を推定 */

const VIN_RE = /[A-HJ-NPR-Z0-9]{17}/;

/** 主要 WMI → メーカー名（完全一致） */
const WMI_MAKE = {
  ZAR: "Alfa Romeo",
  ZFA: "Fiat",
  ZFF: "Ferrari",
  WBA: "BMW",
  WBS: "BMW",
  WBY: "BMW",
  WVW: "Volkswagen",
  WAU: "Audi",
  WUA: "Audi",
  TMB: "Skoda",
  VSS: "Seat",
  JHM: "Honda",
  JH4: "Honda",
  JN1: "Nissan",
  JN8: "Nissan",
  JMB: "Mitsubishi",
  JMZ: "Mazda",
  JTD: "Toyota",
  JT2: "Toyota",
  JTE: "Toyota",
  KMH: "Hyundai",
  KNA: "Kia",
  VF1: "Renault",
  VF3: "Peugeot",
  VF7: "Citroen",
  YV1: "Volvo",
  YV4: "Volvo",
  SAL: "Land Rover",
  SAD: "Jaguar",
  TRU: "Audi",
  "1FA": "Ford",
  "1FT": "Ford",
  "1G1": "Chevrolet",
  "1GC": "Chevrolet",
  WDB: "Mercedes-Benz",
  WDC: "Mercedes-Benz",
  WDD: "Mercedes-Benz",
};

const YEAR_FROM_CODE = {
  A: 2010,
  B: 2011,
  C: 2012,
  D: 2013,
  E: 2014,
  F: 2015,
  G: 2016,
  H: 2017,
  J: 2018,
  K: 2019,
  L: 2020,
  M: 2021,
  N: 2022,
  P: 2023,
  R: 2024,
  S: 2025,
  T: 2026,
  V: 2027,
  W: 2028,
  X: 2029,
  Y: 2030,
};

export function parseVinFromObdResponse(response) {
  if (!response) return null;

  const lines = String(response).toUpperCase().split(/[\r\n]+/);
  const payloadBytes = [];

  for (const line of lines) {
    const tokens = line.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;

    let start = 0;
    if (/^[0-9A-F]{3}$/.test(tokens[0])) start = 1;

    for (let i = start; i < tokens.length; i++) {
      const t = tokens[i];
      if (!/^[0-9A-F]{2}$/.test(t)) continue;
      const n = parseInt(t, 16);
      if (!Number.isNaN(n)) payloadBytes.push(n);
    }
  }

  const isoTpVin = extractVinFromIsoTpBytes(payloadBytes);
  if (isoTpVin) return isoTpVin;

  const cleanHex = response.replace(/[^0-9A-Fa-f]/g, "");
  let ascii = "";
  for (let i = 0; i + 1 < cleanHex.length; i += 2) {
    const code = parseInt(cleanHex.slice(i, i + 2), 16);
    if (code >= 32 && code <= 126) ascii += String.fromCharCode(code);
  }
  const match = ascii.match(VIN_RE);
  return match ? match[0] : null;
}

function extractVinFromIsoTpBytes(bytes) {
  const idx = findSequence(bytes, [0x49, 0x02]);
  if (idx < 0) return null;

  const dataStart = idx + 3;
  const chars = [];
  for (let i = dataStart; i < bytes.length; i++) {
    const b = bytes[i];
    if (b >= 0x30 && b <= 0x39) chars.push(String.fromCharCode(b));
    else if (b >= 0x41 && b <= 0x5a) chars.push(String.fromCharCode(b));
    else if (chars.length && chars.length < 17) {
      if (b === 0x00) break;
    }
    if (chars.length >= 17) break;
  }
  const candidate = chars.join("").toUpperCase();
  return VIN_RE.test(candidate) ? candidate.match(VIN_RE)[0] : null;
}

function findSequence(arr, seq) {
  for (let i = 0; i <= arr.length - seq.length; i++) {
    if (seq.every((v, j) => arr[i + j] === v)) return i;
  }
  return -1;
}

function decodeModelYear(code) {
  if (!code) return "";
  const c = code.toUpperCase();
  if (c >= "0" && c <= "9") return String(2000 + parseInt(c, 10));
  return YEAR_FROM_CODE[c] ? String(YEAR_FROM_CODE[c]) : "";
}

function lookupMake(wmi) {
  if (WMI_MAKE[wmi]) return WMI_MAKE[wmi];
  if (wmi.startsWith("1F")) return "Ford";
  if (wmi.startsWith("1G")) return "GM";
  if (wmi.startsWith("JT")) return "Toyota";
  if (wmi.startsWith("JF")) return "Subaru";
  return "";
}

/** VIN からメーカー・年式などを推定（車種名は VIN だけでは特定不可） */
export function decodeVin(vin) {
  const v = String(vin || "").toUpperCase();
  if (!VIN_RE.test(v)) return null;
  const wmi = v.slice(0, 3);
  return {
    vin: v,
    wmi,
    make: lookupMake(wmi),
    year: decodeModelYear(v[9]),
    vds: v.slice(3, 9),
    serial: v.slice(11),
  };
}

export function parseAndDecodeVin(obdResponse) {
  const vin = parseVinFromObdResponse(obdResponse);
  if (!vin) return null;
  return decodeVin(vin);
}

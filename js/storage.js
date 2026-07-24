import { getTemplate } from "./vehicle-templates.js";
import { instantiateItems } from "./service-plan.js";

export const STORAGE_KEY = "garage-log-v2";
const LEGACY_KEY = "giulietta-service-v1";

export const FREE_VEHICLE_LIMIT = 5;

const defaultSettings = () => ({
  geminiApiKey: "",
});

export function createVehicle({
  make = "",
  model = "",
  nickname = "",
  year = "",
  plate = "",
  templateId = "gasoline-na",
  odometerKm = 0,
  vin = "",
}) {
  const template = getTemplate(templateId);
  return {
    id: crypto.randomUUID(),
    make: make.trim(),
    model: model.trim(),
    nickname: nickname.trim(),
    year: year.trim(),
    plate: plate.trim(),
    vin: String(vin || "")
      .trim()
      .toUpperCase(),
    templateId: template.id,
    odometerKm: Number(odometerKm) || 0,
    odometerUpdatedAt: null,
    items: instantiateItems(template.items),
    records: [],
    createdAt: new Date().toISOString(),
  };
}

function defaultState() {
  const vehicle = createVehicle({ nickname: "マイカー" });
  return {
    schemaVersion: 2,
    activeVehicleId: vehicle.id,
    vehicles: [vehicle],
    settings: defaultSettings(),
  };
}

function migrateLegacyV1(parsed) {
  const v = parsed.vehicle || {};
  const vehicle = createVehicle({
    nickname: v.name || "マイカー",
    year: v.year || "",
    plate: v.plate || "",
    templateId: "gasoline-turbo",
    odometerKm: v.odometerKm || 0,
  });
  vehicle.odometerUpdatedAt = v.odometerUpdatedAt || null;
  if (Array.isArray(parsed.items) && parsed.items.length) {
    vehicle.items = parsed.items;
  }
  if (Array.isArray(parsed.records)) {
    vehicle.records = parsed.records;
  }
  return {
    schemaVersion: 2,
    activeVehicleId: vehicle.id,
    vehicles: [vehicle],
    settings: { ...defaultSettings(), ...(parsed.settings || {}) },
  };
}

function normalizeState(parsed) {
  if (!parsed || parsed.schemaVersion !== 2 || !Array.isArray(parsed.vehicles)) {
    return migrateLegacyV1(parsed || {});
  }
  const vehicles = parsed.vehicles.map((v) => {
    const templateId = v.templateId || "gasoline-na";
    return {
      id: v.id || crypto.randomUUID(),
      make: v.make || "",
      model: v.model || "",
      nickname: v.nickname || "",
      year: v.year || "",
      plate: v.plate || "",
      vin: v.vin || "",
      templateId,
      odometerKm: Number(v.odometerKm) || 0,
      odometerUpdatedAt: v.odometerUpdatedAt || null,
      items:
        Array.isArray(v.items) && v.items.length
          ? v.items
          : instantiateItems(getTemplate(templateId).items, { lastOdometerKm: v.odometerKm }),
      records: Array.isArray(v.records) ? v.records : [],
      createdAt: v.createdAt || new Date().toISOString(),
    };
  });
  const activeVehicleId =
    vehicles.find((v) => v.id === parsed.activeVehicleId)?.id || vehicles[0]?.id || null;
  return {
    schemaVersion: 2,
    activeVehicleId,
    vehicles: vehicles.length ? vehicles : defaultState().vehicles,
    settings: { ...defaultSettings(), ...(parsed.settings || {}) },
  };
}

export function loadState() {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      raw = localStorage.getItem(LEGACY_KEY);
    }
    if (!raw) return defaultState();
    return normalizeState(JSON.parse(raw));
  } catch {
    return defaultState();
  }
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function resetState() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_KEY);
  return defaultState();
}

export function getActiveVehicle(state) {
  return state.vehicles.find((v) => v.id === state.activeVehicleId) || state.vehicles[0];
}

export function vehicleDisplayName(vehicle) {
  if (!vehicle) return "マイカー";
  if (vehicle.nickname) return vehicle.nickname;
  const mm = [vehicle.make, vehicle.model].filter(Boolean).join(" ");
  return mm || "マイカー";
}

export function vehicleSubtitle(vehicle) {
  const parts = [];
  if (vehicle.make && vehicle.model && vehicle.nickname) {
    parts.push([vehicle.make, vehicle.model].filter(Boolean).join(" "));
  }
  if (vehicle.year) parts.push(`${vehicle.year}年`);
  if (vehicle.plate) parts.push(vehicle.plate);
  return parts.join(" · ") || "全車種対応の整備手帳";
}

export const STORAGE_KEY = "giulietta-service-v1";

const defaultState = () => ({
  vehicle: {
    name: "Giulietta 1.4 Competizione MT",
    year: "",
    plate: "",
    odometerKm: 0,
    odometerUpdatedAt: null,
  },
  items: [],
  records: [],
  settings: {
    geminiApiKey: "",
  },
});

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return {
      ...defaultState(),
      ...parsed,
      vehicle: { ...defaultState().vehicle, ...(parsed.vehicle || {}) },
      settings: { ...defaultState().settings, ...(parsed.settings || {}) },
      items: Array.isArray(parsed.items) ? parsed.items : [],
      records: Array.isArray(parsed.records) ? parsed.records : [],
    };
  } catch {
    return defaultState();
  }
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function resetState() {
  localStorage.removeItem(STORAGE_KEY);
  return defaultState();
}

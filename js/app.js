import { loadState, saveState, resetState } from "./storage.js";
import { ensureDefaultItems, upcomingItems, evaluateItem } from "./service-plan.js";
import { createObdClient } from "./obd.js";
import { lookupDtc } from "./dtc-dict.js";
import { askGeminiAboutDtcs } from "./gemini.js";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let state = loadState();
state.items = ensureDefaultItems(state.items);
saveState(state);

let lastTelemetry = {};
let lastDtcs = [];

const toastEl = $("#toast");
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.remove("show"), 2400);
}

function setView(name) {
  $$(".view").forEach((v) => {
    v.hidden = v.dataset.view !== name;
  });
  $$(".nav button").forEach((b) => {
    b.classList.toggle("active", b.dataset.nav === name);
  });
}

function renderHome() {
  const v = state.vehicle;
  $("#home-odometer").textContent = `${Number(v.odometerKm || 0).toLocaleString()} km`;
  $("#home-vehicle").textContent = v.name || "Giulietta";
  const list = $("#home-upcoming");
  const ranked = upcomingItems(state.items, v.odometerKm).slice(0, 4);
  list.innerHTML = ranked
    .map(({ item, eval: e }) => {
      const km =
        e.kmLeft == null ? "距離条件なし" : e.kmLeft <= 0 ? "距離超過" : `残り約 ${e.kmLeft.toLocaleString()} km`;
      const mo =
        e.monthsLeft == null ? "" : e.monthsLeft <= 0 ? " / 期間超過" : ` / 残り約 ${e.monthsLeft} か月`;
      return `<li class="list-item">
        <header>
          <strong>${item.name}</strong>
          <span class="pill ${e.status}">${e.summary}</span>
        </header>
        <p>${km}${mo}</p>
      </li>`;
    })
    .join("");
}

function renderService() {
  const list = $("#service-list");
  list.innerHTML = state.items
    .map((item) => {
      const e = evaluateItem(item, state.vehicle.odometerKm);
      return `<li class="list-item">
        <header>
          <strong>${item.name}</strong>
          <span class="pill ${e.status}">${e.summary}</span>
        </header>
        <p>前回: ${item.lastDate || "—"} / ${Number(item.lastOdometerKm || 0).toLocaleString()} km</p>
        <p>${item.note || ""}</p>
        <div class="row">
          <button class="btn btn-ok" data-done="${item.id}">今日実施した</button>
        </div>
      </li>`;
    })
    .join("");

  const history = $("#service-history");
  const records = [...state.records].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 12);
  history.innerHTML = records.length
    ? records
        .map(
          (r) => `<li class="list-item">
            <header><strong>${r.itemName}</strong><span class="pill">${r.date}</span></header>
            <p>${Number(r.odometerKm).toLocaleString()} km${r.cost ? ` / ¥${Number(r.cost).toLocaleString()}` : ""}${r.note ? ` — ${r.note}` : ""}</p>
          </li>`
        )
        .join("")
    : `<li class="list-item"><p>まだ記録がありません。</p></li>`;
}

function renderSettings() {
  $("#set-name").value = state.vehicle.name || "";
  $("#set-year").value = state.vehicle.year || "";
  $("#set-plate").value = state.vehicle.plate || "";
  $("#set-odo").value = state.vehicle.odometerKm || 0;
  $("#set-gemini").value = state.settings.geminiApiKey || "";
}

function markDone(itemId) {
  const item = state.items.find((i) => i.id === itemId);
  if (!item) return;
  const today = new Date().toISOString().slice(0, 10);
  const odo = Number(state.vehicle.odometerKm || 0);
  item.lastDate = today;
  item.lastOdometerKm = odo;
  state.records.push({
    id: crypto.randomUUID(),
    itemId: item.id,
    itemName: item.name,
    date: today,
    odometerKm: odo,
    cost: null,
    note: "",
  });
  saveState(state);
  toast(`${item.name} を記録しました`);
  renderHome();
  renderService();
}

function addCustomRecord(ev) {
  ev.preventDefault();
  const itemId = $("#rec-item").value;
  const item = state.items.find((i) => i.id === itemId);
  if (!item) return;
  const date = $("#rec-date").value || new Date().toISOString().slice(0, 10);
  const odo = Number($("#rec-odo").value || state.vehicle.odometerKm || 0);
  const cost = $("#rec-cost").value ? Number($("#rec-cost").value) : null;
  const note = $("#rec-note").value.trim();

  item.lastDate = date;
  item.lastOdometerKm = odo;
  state.vehicle.odometerKm = Math.max(Number(state.vehicle.odometerKm || 0), odo);
  state.vehicle.odometerUpdatedAt = new Date().toISOString();
  state.records.push({
    id: crypto.randomUUID(),
    itemId,
    itemName: item.name,
    date,
    odometerKm: odo,
    cost,
    note,
  });
  saveState(state);
  $("#record-form").reset();
  $("#rec-date").value = new Date().toISOString().slice(0, 10);
  $("#rec-odo").value = state.vehicle.odometerKm;
  toast("整備記録を追加しました");
  renderHome();
  renderService();
}

function fillRecordItemOptions() {
  $("#rec-item").innerHTML = state.items
    .map((i) => `<option value="${i.id}">${i.name}</option>`)
    .join("");
}

function updateObdUi(telemetry) {
  lastTelemetry = telemetry || {};
  $("#g-rpm").textContent = telemetry.rpm == null ? "—" : telemetry.rpm;
  $("#g-speed").textContent = telemetry.speed == null ? "—" : telemetry.speed;
  $("#g-coolant").textContent = telemetry.coolant == null ? "—" : telemetry.coolant;
  $("#g-map").textContent = telemetry.map == null ? "—" : telemetry.map;
  $("#g-throttle").textContent = telemetry.throttle == null ? "—" : telemetry.throttle;
  const boost = telemetry.boostBar == null ? 0 : Math.min(1.5, Math.max(0, telemetry.boostBar));
  $("#g-boost").textContent = boost.toFixed(2);
}

function setObdStatus(s) {
  const el = $("#obd-status");
  const map = {
    disconnected: ["未接続", ""],
    scanning: ["検索中…", "warn"],
    connected: ["接続中", "ok"],
    sim: ["デモ", "warn"],
  };
  const [label, cls] = map[s] || ["—", ""];
  el.textContent = label;
  el.className = `pill ${cls}`.trim();
}

function appendObdLog(msg) {
  const box = $("#obd-log");
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  box.textContent = `${box.textContent}\n${line}`.trim().slice(-4000);
  box.scrollTop = box.scrollHeight;
}

const obd = createObdClient({
  onLog: (msg) => appendObdLog(msg),
  onTelemetry: updateObdUi,
  onStatus: setObdStatus,
});

function renderDtcs(codes) {
  lastDtcs = codes;
  const box = $("#dtc-list");
  if (!codes.length) {
    box.innerHTML = `<li class="list-item"><p>故障コードは見つかりませんでした。</p></li>`;
    return;
  }
  box.innerHTML = codes
    .map((c) => {
      const d = lookupDtc(c);
      return `<li class="list-item">
        <header><strong>${c}</strong><span class="pill due">${d.name}</span></header>
        <p>${d.desc}</p>
      </li>`;
    })
    .join("");
}

async function onAskAi() {
  const out = $("#ai-out");
  out.textContent = "問い合わせ中…";
  try {
    const text = await askGeminiAboutDtcs({
      apiKey: state.settings.geminiApiKey,
      codes: lastDtcs,
      vehicleLabel: state.vehicle.name,
      telemetry: lastTelemetry,
    });
    out.textContent = text;
  } catch (err) {
    out.textContent = err.message || String(err);
    toast("AI相談に失敗しました");
  }
}

function wire() {
  $$(".nav button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = btn.dataset.nav;
      setView(name);
      if (name === "home") renderHome();
      if (name === "service") renderService();
      if (name === "settings") renderSettings();
    });
  });

  $("#odo-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const km = Number($("#odo-input").value);
    if (Number.isNaN(km) || km < 0) return;
    state.vehicle.odometerKm = km;
    state.vehicle.odometerUpdatedAt = new Date().toISOString();
    saveState(state);
    toast("走行距離を更新しました");
    renderHome();
  });

  $("#service-list").addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-done]");
    if (!btn) return;
    markDone(btn.dataset.done);
  });

  $("#record-form").addEventListener("submit", addCustomRecord);

  $("#settings-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    state.vehicle.name = $("#set-name").value.trim() || state.vehicle.name;
    state.vehicle.year = $("#set-year").value.trim();
    state.vehicle.plate = $("#set-plate").value.trim();
    state.vehicle.odometerKm = Number($("#set-odo").value || 0);
    state.settings.geminiApiKey = $("#set-gemini").value.trim();
    saveState(state);
    toast("設定を保存しました");
    renderHome();
  });

  $("#btn-reset").addEventListener("click", () => {
    if (!confirm("すべての整備記録・設定を消します。よろしいですか？")) return;
    state = resetState();
    state.items = ensureDefaultItems([]);
    saveState(state);
    fillRecordItemOptions();
    renderHome();
    renderService();
    renderSettings();
    toast("初期化しました");
  });

  $("#btn-obd-connect").addEventListener("click", async () => {
    try {
      await obd.connect();
      toast("OBDに接続しました");
    } catch (err) {
      appendObdLog(err.message || String(err));
      toast(err.message || "接続に失敗");
      setObdStatus("disconnected");
    }
  });

  $("#btn-obd-demo").addEventListener("click", () => {
    obd.startSimulation();
    toast("デモ開始");
  });

  $("#btn-obd-disconnect").addEventListener("click", () => {
    obd.disconnect();
    toast("切断しました");
  });

  $("#btn-dtc-read").addEventListener("click", async () => {
    try {
      const codes = await obd.readDtcs();
      renderDtcs(codes);
      toast(`DTC ${codes.length} 件`);
    } catch (err) {
      appendObdLog(err.message || String(err));
      toast(err.message || "DTC読取失敗");
    }
  });

  $("#btn-dtc-clear").addEventListener("click", async () => {
    if (!confirm("ECUの故障コード消去を送信します。整備後などに限って使ってください。続行しますか？")) return;
    try {
      await obd.clearDtcs();
      renderDtcs([]);
      toast("消去コマンドを送りました");
    } catch (err) {
      toast(err.message || "消去失敗");
    }
  });

  $("#btn-ask-ai").addEventListener("click", onAskAi);

  const bleOk = !!navigator.bluetooth;
  $("#ble-hint").textContent = bleOk
    ? "Web Bluetooth 利用可。BLE対応アダプタを選んでください（クラシックBTのみは不可）。"
    : "このブラウザは Web Bluetooth 非対応です。Chrome/Edge か、デモモードを使ってください。";
}

function boot() {
  fillRecordItemOptions();
  $("#rec-date").value = new Date().toISOString().slice(0, 10);
  $("#rec-odo").value = state.vehicle.odometerKm || 0;
  $("#odo-input").value = state.vehicle.odometerKm || 0;
  setObdStatus("disconnected");
  wire();
  setView("home");
  renderHome();
  renderService();
  renderSettings();
}

boot();

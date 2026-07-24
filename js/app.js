import {
  loadState,
  saveState,
  resetState,
  getActiveVehicle,
  vehicleDisplayName,
  vehicleSubtitle,
  createVehicle,
  FREE_VEHICLE_LIMIT,
} from "./storage.js";
import { upcomingItems, evaluateItem, itemsFromTemplate } from "./service-plan.js";
import { templateOptionsHtml } from "./vehicle-templates.js";
import { createObdClient } from "./obd.js";
import { lookupDtc, preloadDtcForMake, SEVERITY_LABELS, severityClass } from "./dtc-dict.js";
import { askGeminiAboutDtcs } from "./gemini.js";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let state = loadState();
saveState(state);

let lastTelemetry = {};
let lastDtcs = [];
let lastVinResult = null;

function active() {
  return getActiveVehicle(state);
}

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

function renderVehicleSwitcher() {
  const v = active();
  $("#vehicle-select").innerHTML = state.vehicles
    .map(
      (car) =>
        `<option value="${car.id}" ${car.id === state.activeVehicleId ? "selected" : ""}>${vehicleDisplayName(car)}</option>`
    )
    .join("");
  $("#home-vehicle").textContent = vehicleDisplayName(v);
  $("#home-subtitle").textContent = vehicleSubtitle(v);
}

function renderHome() {
  const v = active();
  renderVehicleSwitcher();
  $("#home-odometer").textContent = `${Number(v.odometerKm || 0).toLocaleString()} km`;
  const list = $("#home-upcoming");
  const ranked = upcomingItems(v.items, v.odometerKm).slice(0, 4);
  list.innerHTML = ranked.length
    ? ranked
        .map(({ item, eval: e }) => {
          const km =
            e.kmLeft == null
              ? "距離条件なし"
              : e.kmLeft <= 0
                ? "距離超過"
                : `残り約 ${e.kmLeft.toLocaleString()} km`;
          const mo =
            e.monthsLeft == null
              ? ""
              : e.monthsLeft <= 0
                ? " / 期間超過"
                : ` / 残り約 ${e.monthsLeft} か月`;
          return `<li class="list-item">
        <header>
          <strong>${item.name}</strong>
          <span class="pill ${e.status}">${e.summary}</span>
        </header>
        <p>${km}${mo}</p>
      </li>`;
        })
        .join("")
    : `<li class="list-item"><p>整備メニューがありません。設定で車両を追加してください。</p></li>`;
}

function renderService() {
  const v = active();
  const list = $("#service-list");
  list.innerHTML = v.items
    .map((item) => {
      const e = evaluateItem(item, v.odometerKm);
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
  const records = [...v.records].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 12);
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

function renderVehiclesPanel() {
  const list = $("#vehicle-list");
  list.innerHTML = state.vehicles
    .map((car) => {
      const activeMark = car.id === state.activeVehicleId ? '<span class="pill ok">選択中</span>' : "";
      return `<li class="list-item">
        <header>
          <strong>${vehicleDisplayName(car)}</strong>
          ${activeMark}
        </header>
        <p>${[car.make, car.model].filter(Boolean).join(" ") || "—"}${car.year ? ` · ${car.year}年` : ""}</p>
        <p>${Number(car.odometerKm || 0).toLocaleString()} km · メニュー ${car.items.length} 件</p>
        <div class="row">
          <button class="btn btn-ghost" type="button" data-switch="${car.id}">この車に切替</button>
          <button class="btn btn-danger" type="button" data-delete="${car.id}" ${state.vehicles.length <= 1 ? "disabled" : ""}>削除</button>
        </div>
      </li>`;
    })
    .join("");

  $("#add-template").innerHTML = templateOptionsHtml("gasoline-na");
  const atLimit = state.vehicles.length >= FREE_VEHICLE_LIMIT;
  $("#add-vehicle-hint").textContent = atLimit
    ? `無料版は ${FREE_VEHICLE_LIMIT} 台まで登録できます。`
    : `あと ${FREE_VEHICLE_LIMIT - state.vehicles.length} 台追加できます。`;
  $("#btn-add-vehicle").disabled = atLimit;
}

function renderSettings() {
  const v = active();
  $("#set-make").value = v.make || "";
  $("#set-model").value = v.model || "";
  $("#set-nickname").value = v.nickname || "";
  $("#set-year").value = v.year || "";
  $("#set-plate").value = v.plate || "";
  $("#set-vin").value = v.vin || "";
  $("#set-odo").value = v.odometerKm || 0;
  $("#set-template").innerHTML = templateOptionsHtml(v.templateId);
  $("#set-gemini").value = state.settings.geminiApiKey || "";
  renderVehiclesPanel();
}

function markDone(itemId) {
  const v = active();
  const item = v.items.find((i) => i.id === itemId);
  if (!item) return;
  const today = new Date().toISOString().slice(0, 10);
  const odo = Number(v.odometerKm || 0);
  item.lastDate = today;
  item.lastOdometerKm = odo;
  v.records.push({
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
  const v = active();
  const itemId = $("#rec-item").value;
  const item = v.items.find((i) => i.id === itemId);
  if (!item) return;
  const date = $("#rec-date").value || new Date().toISOString().slice(0, 10);
  const odo = Number($("#rec-odo").value || v.odometerKm || 0);
  const cost = $("#rec-cost").value ? Number($("#rec-cost").value) : null;
  const note = $("#rec-note").value.trim();

  item.lastDate = date;
  item.lastOdometerKm = odo;
  v.odometerKm = Math.max(Number(v.odometerKm || 0), odo);
  v.odometerUpdatedAt = new Date().toISOString();
  v.records.push({
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
  $("#rec-odo").value = v.odometerKm;
  toast("整備記録を追加しました");
  renderHome();
  renderService();
}

function fillRecordItemOptions() {
  const v = active();
  $("#rec-item").innerHTML = v.items
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

function formatVinHint(decoded) {
  if (!decoded) return "接続後に読み取れます";
  const parts = [];
  if (decoded.make) parts.push(decoded.make);
  if (decoded.year) parts.push(`${decoded.year}年式`);
  if (decoded.wmi) parts.push(`WMI ${decoded.wmi}`);
  return parts.length ? parts.join(" · ") : "VINを取得しました";
}

function renderVinPanel() {
  const v = active();
  const display = lastVinResult?.vin || v.vin || "—";
  $("#vin-display").textContent = display;
  $("#vin-decode-hint").textContent = lastVinResult
    ? formatVinHint(lastVinResult)
    : v.vin
      ? "設定に保存済み"
      : "接続後に読み取れます";
  $("#btn-vin-apply").disabled = !lastVinResult?.vin;
}

function applyVinToVehicle() {
  if (!lastVinResult?.vin) return;
  const v = active();
  v.vin = lastVinResult.vin;
  if (lastVinResult.make && !v.make.trim()) v.make = lastVinResult.make;
  if (lastVinResult.year && !v.year.trim()) v.year = lastVinResult.year;
  saveState(state);
  renderSettings();
  renderHome();
  renderVinPanel();
  toast("VINを車両に反映しました");
}

async function renderDtcs(codes) {
  lastDtcs = codes;
  const box = $("#dtc-list");
  const make = active()?.make || "";
  if (!codes.length) {
    box.innerHTML = `<li class="list-item"><p>故障コードは見つかりませんでした。</p></li>`;
    return;
  }
  box.innerHTML = `<li class="list-item"><p>コードを解釈しています…</p></li>`;
  try {
    await preloadDtcForMake(make);
  } catch {
    /* 汎用のみで続行 */
  }
  const rows = await Promise.all(
    codes.map(async (c) => {
      const d = await lookupDtc(c, make);
      const sev = SEVERITY_LABELS[d.severity] ?? SEVERITY_LABELS[1];
      const source =
        d.source === "generic"
          ? "汎用"
          : d.source?.startsWith("oem:")
            ? "メーカー"
            : "未登録";
      return `<li class="list-item">
        <header>
          <strong>${c}</strong>
          <span class="pill ${severityClass(d.severity)}">${sev}</span>
        </header>
        <p><strong>${d.name}</strong></p>
        <p>${d.desc}</p>
        <p class="note">出典: ${source}${make ? ` · 車両: ${make}` : ""}</p>
      </li>`;
    })
  );
  box.innerHTML = rows.join("");
}

async function onAskAi() {
  const out = $("#ai-out");
  out.textContent = "問い合わせ中…";
  try {
    const text = await askGeminiAboutDtcs({
      apiKey: state.settings.geminiApiKey,
      codes: lastDtcs,
      vehicle: active(),
      telemetry: lastTelemetry,
    });
    out.textContent = text;
  } catch (err) {
    out.textContent = err.message || String(err);
    toast("AI相談に失敗しました");
  }
}

function switchVehicle(id) {
  if (!state.vehicles.some((v) => v.id === id)) return;
  state.activeVehicleId = id;
  lastVinResult = null;
  saveState(state);
  fillRecordItemOptions();
  const v = active();
  $("#odo-input").value = v.odometerKm || 0;
  $("#rec-odo").value = v.odometerKm || 0;
  renderHome();
  renderService();
  renderSettings();
  renderVinPanel();
  toast(`${vehicleDisplayName(v)} に切り替えました`);
}

function wire() {
  $$(".nav button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = btn.dataset.nav;
      setView(name);
      if (name === "home") renderHome();
      if (name === "service") {
        fillRecordItemOptions();
        renderService();
      }
      if (name === "settings") renderSettings();
      if (name === "obd") renderVinPanel();
    });
  });

  $("#vehicle-select").addEventListener("change", (ev) => {
    switchVehicle(ev.target.value);
  });

  $("#odo-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const v = active();
    const km = Number($("#odo-input").value);
    if (Number.isNaN(km) || km < 0) return;
    v.odometerKm = km;
    v.odometerUpdatedAt = new Date().toISOString();
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
    const v = active();
    v.make = $("#set-make").value.trim();
    v.model = $("#set-model").value.trim();
    v.nickname = $("#set-nickname").value.trim();
    v.year = $("#set-year").value.trim();
    v.plate = $("#set-plate").value.trim();
    v.vin = $("#set-vin").value.trim().toUpperCase();
    v.odometerKm = Number($("#set-odo").value || 0);
    state.settings.geminiApiKey = $("#set-gemini").value.trim();
    saveState(state);
    toast("設定を保存しました");
    renderHome();
    renderVehiclesPanel();
  });

  $("#btn-apply-template").addEventListener("click", () => {
    const v = active();
    const templateId = $("#set-template").value;
    if (
      !confirm(
        "選択したテンプレートで整備メニューを上書きします。既存のメニュー項目は置き換わります（履歴は残ります）。続行しますか？"
      )
    ) {
      return;
    }
    v.templateId = templateId;
    v.items = itemsFromTemplate(templateId, v.odometerKm);
    saveState(state);
    fillRecordItemOptions();
    renderHome();
    renderService();
    toast("テンプレートを適用しました");
  });

  $("#add-vehicle-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    if (state.vehicles.length >= FREE_VEHICLE_LIMIT) {
      toast(`登録上限（${FREE_VEHICLE_LIMIT}台）に達しています`);
      return;
    }
    const car = createVehicle({
      make: $("#add-make").value,
      model: $("#add-model").value,
      nickname: $("#add-nickname").value,
      year: $("#add-year").value,
      plate: $("#add-plate").value,
      templateId: $("#add-template").value,
      odometerKm: Number($("#add-odo").value || 0),
    });
    state.vehicles.push(car);
    state.activeVehicleId = car.id;
    saveState(state);
    $("#add-vehicle-form").reset();
    switchVehicle(car.id);
    toast("車両を追加しました");
  });

  $("#vehicle-list").addEventListener("click", (ev) => {
    const sw = ev.target.closest("[data-switch]");
    if (sw) {
      switchVehicle(sw.dataset.switch);
      return;
    }
    const del = ev.target.closest("[data-delete]");
    if (!del) return;
    if (state.vehicles.length <= 1) return;
    if (!confirm("この車両とその整備記録を削除します。よろしいですか？")) return;
    state.vehicles = state.vehicles.filter((v) => v.id !== del.dataset.delete);
    if (!state.vehicles.some((v) => v.id === state.activeVehicleId)) {
      state.activeVehicleId = state.vehicles[0].id;
    }
    saveState(state);
    switchVehicle(state.activeVehicleId);
    toast("車両を削除しました");
  });

  $("#btn-reset").addEventListener("click", () => {
    if (!confirm("すべての車両・整備記録・設定を消します。よろしいですか？")) return;
    state = resetState();
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
      await renderDtcs(codes);
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
      await renderDtcs([]);
      toast("消去コマンドを送りました");
    } catch (err) {
      toast(err.message || "消去失敗");
    }
  });

  $("#btn-ask-ai").addEventListener("click", onAskAi);

  $("#btn-vin-read").addEventListener("click", async () => {
    try {
      const decoded = await obd.readVin();
      lastVinResult = decoded;
      renderVinPanel();
      toast(`VIN: ${decoded.vin}`);
    } catch (err) {
      appendObdLog(err.message || String(err));
      toast(err.message || "VIN読取失敗");
    }
  });

  $("#btn-vin-apply").addEventListener("click", applyVinToVehicle);

  const bleOk = !!navigator.bluetooth;
  $("#ble-hint").textContent = bleOk
    ? "Web Bluetooth 利用可。BLE対応 ELM327（FFE0/FFF0、IOS-Vlink/OBDLink）に対応。クラシックBTのみは不可。OBD-II 対応車ならメーカー問わず利用できます。"
    : "このブラウザは Web Bluetooth 非対応です。Chrome/Edge か、デモモードを使ってください。";
}

function boot() {
  fillRecordItemOptions();
  const v = active();
  $("#rec-date").value = new Date().toISOString().slice(0, 10);
  $("#rec-odo").value = v.odometerKm || 0;
  $("#odo-input").value = v.odometerKm || 0;
  setObdStatus("disconnected");
  renderVinPanel();
  wire();
  setView("home");
  renderHome();
  renderService();
  renderSettings();
}

boot();

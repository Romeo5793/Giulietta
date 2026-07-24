/**
 * Live OBD Dashboard UI — visual layer only.
 * BLE / storage / DTC lookup are provided by app.js.
 */

import { lookupDtc, preloadDtcForMake } from "./dtc-dict.js";
import { askGeminiAboutDtcs } from "./gemini.js";

const COMPATIBLE_BRANDS = [
  "PORSCHE", "BMW", "MERCEDES", "AUDI", "VW", "TOYOTA", "NISSAN",
  "HONDA", "SUBARU", "MAZDA", "MCLAREN", "FERRARI", "ASTON MARTIN",
];

const COLORS = { alfaRed: "#D1121C", coolBlue: "#3B82F6", grayNatural: "#9CA3AF", garageRed: "#de000a" };
const LPF_ALPHA = 0.2;
const MAX_G_HISTORY = 12;
const ENGINE_FPS = 30;
const ENGINE_FRAME_MS = 1000 / ENGINE_FPS;

let active = false;
let obd = null;
let getState = () => ({});
let toast = () => {};
let audioCtx = null;

let currentMode = "natural";
let isRetroSkin = false;
let isSimulation = true;
let pollPaused = false;

let data = { rpm: 800, speed: 0, coolant: 85, intake: 24, boost: 0, map: 100, baro: 100, throttle: 0, pedal: 0, timing: 0, hp: 0, torque: 0 };
let peaks = { rpm: 0, speed: 0, coolant: 0, dynamic: 0, hp: 0, torque: 0 };
let anim = {
  rpm: { val: 800, vel: 0 },
  speed: { val: 0, vel: 0 },
  boost: { val: 0, vel: 0 },
  hp: { val: 0, vel: 0 },
  torque: { val: 0, vel: 0 },
  coolant: { val: 85, vel: 0 },
  intake: { val: 24, vel: 0 },
  gX: { val: 0 },
  gY: { val: 0 },
};
let lastWarningTime = 0;
let lastObdMode = "idle";
let debugFullLogs = [];

let gHistory = [];
let peakG = 0;
let peakGCoords = { x: 0, y: 0 };
let rawAcc = { x: 0, y: 0 };
let gOffset = { x: 0, y: 0 };
let gCalibrating = false;
let currentG = { x: 0, y: 0 };
let filteredG = { x: 0, y: 0 };

let gCanvas = null;
let gCtx = null;
let engineLoopId = null;
let engineLastFrame = 0;
let lastGHistoryTime = 0;
let pendingTelemetry = null;
let motionBound = false;
let csvRows = [];
let csvTimer = null;
let lastDtcs = [];

function updatePhysics(key, target, stiffness, damping) {
  const a = anim[key];
  const force = (target - a.val) * stiffness;
  a.vel = (a.vel + force) * damping;
  a.val += a.vel;
}

function updateLPF(key, target, alpha) {
  anim[key].val += (target - anim[key].val) * alpha;
}

function computeEngineDerived() {
  let currentMap = data.map || 100;
  if (isSimulation) {
    currentMap = data.boost > 0 ? data.boost * 100 + 100 : 30 + (data.rpm / 8000) * 70;
  }
  let rpmFactor = 1;
  if (data.rpm < 2500) rpmFactor = Math.max(0.2, data.rpm / 2500);
  else if (data.rpm > 5000) rpmFactor = Math.max(0.6, 1 - (data.rpm - 5000) / 4000);
  data.torque = currentMap * 1.05 * rpmFactor;
  data.hp = (data.torque * data.rpm) / 7022;
}

function updateGaugeArcColor() {
  const gaugeArc = $("gauge-arc");
  if (!gaugeArc) return;
  if (isRetroSkin) {
    gaugeArc.style.stroke = COLORS.alfaRed;
    return;
  }
  if (currentMode === "dynamic") gaugeArc.style.stroke = COLORS.alfaRed;
  else if (currentMode === "natural") gaugeArc.style.stroke = COLORS.grayNatural;
  else gaugeArc.style.stroke = COLORS.coolBlue;
}

function startUiPump() {
  startEngineLoop();
}

function stopUiPump() {
  stopEngineLoop();
}

function startEngineLoop() {
  if (engineLoopId) return;
  engineLastFrame = 0;
  const tick = (now) => {
    if (!active) {
      engineLoopId = null;
      return;
    }
    if (!engineLastFrame) engineLastFrame = now;
    if (now - engineLastFrame >= ENGINE_FRAME_MS) {
      engineLastFrame = now - ((now - engineLastFrame) % ENGINE_FRAME_MS);
      if (pendingTelemetry) {
        applyTelemetry(pendingTelemetry);
        pendingTelemetry = null;
      }
      stepPhysics();
      renderUi();
      if (now - lastGHistoryTime > 60) {
        gHistory.push({ x: anim.gX.val, y: anim.gY.val });
        if (gHistory.length > MAX_G_HISTORY) gHistory.shift();
        lastGHistoryTime = now;
        drawGForceRadar();
      }
    }
    engineLoopId = requestAnimationFrame(tick);
  };
  engineLoopId = requestAnimationFrame(tick);
}

function stopEngineLoop() {
  if (engineLoopId) {
    cancelAnimationFrame(engineLoopId);
    engineLoopId = null;
  }
}

function stepPhysics() {
  updatePhysics("rpm", data.rpm, 0.08, 0.8);
  updatePhysics("boost", data.boost, 0.1, 0.75);
  updatePhysics("speed", data.speed, 0.04, 0.85);
  updatePhysics("hp", data.hp, 0.06, 0.8);
  updatePhysics("torque", data.torque, 0.06, 0.8);
  updatePhysics("coolant", data.coolant, 0.02, 0.9);
  updatePhysics("intake", data.intake, 0.02, 0.9);
  const targetGX = isSimulation ? currentG.x : filteredG.x;
  const targetGY = isSimulation ? currentG.y : filteredG.y;
  updateLPF("gX", targetGX, 0.15);
  updateLPF("gY", targetGY, 0.15);
}

const $ = (id) => document.getElementById(id);

function playAlertSound(frequency, duration) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(frequency, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch {
    /* ignore */
  }
}

function playWarningBeeps() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const beep = (offset) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(1500, audioCtx.currentTime + offset);
      gain.gain.setValueAtTime(0, audioCtx.currentTime + offset);
      gain.gain.linearRampToValueAtTime(0.08, audioCtx.currentTime + offset + 0.01);
      gain.gain.setValueAtTime(0.08, audioCtx.currentTime + offset + 0.08);
      gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + offset + 0.1);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(audioCtx.currentTime + offset);
      osc.stop(audioCtx.currentTime + offset + 0.1);
    };
    beep(0);
    beep(0.15);
    beep(0.3);
  } catch {
    /* ignore */
  }
}

function applyScreenScale() {
  const wrapper = $("app-wrapper");
  if (!wrapper) return;
  const targetWidth = 852;
  const targetHeight = 393;
  const isMobile =
    (window.innerWidth <= 950 && window.innerHeight <= 450) ||
    /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  if (isMobile) {
    const scale = Math.min(window.innerWidth / targetWidth, window.innerHeight / targetHeight);
    wrapper.style.width = `${targetWidth}px`;
    wrapper.style.height = `${targetHeight}px`;
    wrapper.style.transform = `scale(${scale})`;
    wrapper.style.borderRadius = "0";
    wrapper.style.border = "none";
    wrapper.style.boxShadow = "none";
  } else {
    let scale = Math.min(window.innerWidth / (targetWidth + 40), window.innerHeight / (targetHeight + 40));
    if (scale > 1) scale = 1;
    wrapper.style.width = `${targetWidth}px`;
    wrapper.style.height = `${targetHeight}px`;
    wrapper.style.transform = `scale(${scale})`;
    wrapper.style.borderRadius = "38px";
    wrapper.style.border = "6px solid #1a1a1c";
    wrapper.style.boxShadow = "0 20px 50px rgba(0, 0, 0, 0.8)";
  }
}

function logConsole(message, type = "system") {
  debugFullLogs.push(`[${new Date().toISOString()}] [${type.toUpperCase()}] ${message}`);
  if (debugFullLogs.length > 500) debugFullLogs.shift();
  if (!active) return;
  const panel = $("console-logs-container");
  if (!panel) return;
  const time =
    new Date().toLocaleTimeString("ja-JP", { hour12: false }) +
    "." +
    String(Math.floor(Math.random() * 99)).padStart(2, "0");
  const colors = { tx: "text-green-400", rx: "text-cyan-300 font-bold", error: "text-red-500 font-extrabold", system: "text-gray-500 opacity-80" };
  const el = document.createElement("div");
  el.className = `${colors[type] || "text-cyan-400"} flex justify-between gap-2`;
  el.innerHTML = `<span>${time} | ${message}</span>`;
  panel.insertBefore(el, panel.firstChild);
  if (panel.children.length > 25) panel.removeChild(panel.lastChild);
}

function showTextDataModal(title, content) {
  const container = document.createElement("div");
  container.style.cssText =
    "position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.95);z-index:9999;display:flex;flex-direction:column;padding:max(20px,env(safe-area-inset-top)) 20px max(20px,env(safe-area-inset-bottom)) 20px;box-sizing:border-box;";
  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;margin-bottom:10px;align-items:center;">
      <h3 style="color:white;margin:0;font-family:monospace;font-size:12px;">${title}</h3>
      <div style="display:flex;gap:10px;">
        <button id="modal-copy-btn" style="padding:8px 12px;background:#3B82F6;color:white;border:none;border-radius:4px;font-weight:bold;font-size:12px;">COPY</button>
        <button id="modal-close-btn" style="padding:8px 12px;background:#D1121C;color:white;border:none;border-radius:4px;font-weight:bold;font-size:12px;">✖</button>
      </div>
    </div>
    <textarea id="modal-textarea" readonly style="flex:1;width:100%;background:#111;color:#0f0;font-family:monospace;font-size:10px;padding:10px;border:1px solid #333;border-radius:4px;white-space:pre;overflow:scroll;"></textarea>
  `;
  document.body.appendChild(container);
  $("modal-textarea").value = content;
  $("modal-copy-btn").onclick = async () => {
    try {
      await navigator.clipboard.writeText(content);
      toast("クリップボードにコピーしました");
    } catch {
      $("modal-textarea").select();
      document.execCommand("copy");
      toast("コピーしました");
    }
  };
  $("modal-close-btn").onclick = () => document.body.removeChild(container);
}

function exportDebugLog() {
  if (debugFullLogs.length === 0) return;
  showTextDataModal("📋 DEBUG LOGS", `=== DEBUG LOGS ===\n${debugFullLogs.join("\n")}\n=== END ===`);
}

function showBleWarning() {
  const bluefyBtn = $("btn-open-bluefy");
  if (bluefyBtn) bluefyBtn.href = window.location.href.replace(/^https?:\/\//i, "bluefy://");
  $("ble-warning-modal")?.classList.remove("hidden");
}

function closeBleWarning() {
  $("ble-warning-modal")?.classList.add("hidden");
}

async function copyAppUrl() {
  const url = window.location.href;
  try {
    await navigator.clipboard.writeText(url);
    toast("URLをコピーしました");
  } catch {
    showTextDataModal("APP URL", url);
  }
}

function showGsensorModal() {
  if (sessionStorage.getItem("garage-log-gsensor-skip") === "1") return;
  $("g-sensor-modal")?.classList.remove("hidden");
}

function skipGsensor() {
  sessionStorage.setItem("garage-log-gsensor-skip", "1");
  $("g-sensor-modal")?.classList.add("hidden");
}

async function enableGsensorAndCalibrate() {
  $("g-sensor-modal")?.classList.add("hidden");
  await calibrateGForce();
}

function hasWebBluetooth() {
  return !!navigator.bluetooth;
}

function initStaffRoll() {
  const html = COMPATIBLE_BRANDS.map((b) => `<span class="text-[9px] font-bold font-mono tracking-widest text-gray-400 text-center">${b}</span>`).join("");
  const c1 = $("staff-roll-content-1");
  const c2 = $("staff-roll-content-2");
  if (c1) c1.innerHTML = html;
  if (c2) c2.innerHTML = html;
}

function setConnectionUi(mode) {
  isSimulation = mode === "sim" || mode === "idle";
  const indicator = $("status-indicator");
  const statusText = $("connection-status");
  const connectText = $("connect-text");
  const connectIcon = $("connect-icon");
  if (!indicator) return;

  if (mode === "live") {
    indicator.className = "w-1.5 h-1.5 rounded-full bg-green-500 shadow-lg shadow-green-500/50";
    statusText.textContent = "OBD Ready";
    connectText.textContent = "Disconnect";
    connectIcon.className = "fa-solid fa-circle-xmark";
  } else if (mode === "sim") {
    indicator.className = "w-1.5 h-1.5 rounded-full bg-yellow-500 shadow-lg shadow-yellow-500/50 animate-pulse";
    statusText.textContent = "Demo Mode";
    connectText.textContent = "Connect Car";
    connectIcon.className = "fa-solid fa-bluetooth";
  } else {
    indicator.className = "w-1.5 h-1.5 rounded-full bg-yellow-500 shadow-lg shadow-yellow-500/50 animate-pulse";
    statusText.textContent = "Demo Mode";
    connectText.textContent = "Connect Car";
    connectIcon.className = "fa-solid fa-bluetooth";
  }
}

function toggleRetroSkin() {
  isRetroSkin = !isRetroSkin;
  document.body.classList.toggle("retro-bg", isRetroSkin);

  const brandLogo = $("brand-logo");
  const dnaContainer = $("dna-switch-container");
  const carouselContainer = $("brand-carousel-container");
  const rpmText = $("rpm-value");

  const alfaEmblem = `<svg viewBox="0 0 100 100" class="w-9 h-9 drop-shadow-lg shrink-0" aria-hidden="true">
    <circle cx="50" cy="50" r="48" fill="#0f172a" stroke="#d97706" stroke-width="2"/>
    <circle cx="50" cy="50" r="40" fill="#f8fafc" stroke="#d97706" stroke-width="1"/>
    <path d="M 50 10 A 40 40 0 0 0 50 90 Z" fill="#f8fafc"/>
    <path d="M 50 10 A 40 40 0 0 1 50 90 Z" fill="#e0f2fe"/>
    <rect x="18" y="44" width="32" height="12" fill="#b91c1c"/>
    <rect x="28" y="18" width="12" height="64" fill="#b91c1c"/>
    <path d="M 65 25 C 80 15, 90 35, 75 45 C 65 55, 85 65, 75 80 C 60 85, 55 65, 65 55 C 75 45, 50 35, 65 25 Z" fill="#15803d"/>
    <path d="M 50 10 L 50 90" stroke="#d97706" stroke-width="1"/>
  </svg>`;

  if (isRetroSkin) {
    brandLogo.innerHTML = `${alfaEmblem}<div class="flex flex-col items-start justify-center"><span class="font-serif-brand text-[8px] text-amber-500 leading-none tracking-widest uppercase">Alfa Romeo</span><span class="font-cursive-alfa text-red-600 leading-none mt-0.5">Giulietta</span></div>`;
    brandLogo.className = "flex items-center gap-1.5 cursor-pointer hover:opacity-80 transition-opacity drop-shadow-md";
    dnaContainer?.classList.remove("hidden");
    dnaContainer?.classList.add("flex");
    carouselContainer?.classList.add("hidden");
    carouselContainer?.classList.remove("flex");
  } else {
    brandLogo.innerHTML = `<span class="text-white"><i class="fa-solid fa-gauge-high"></i></span> GARAGERED`;
    brandLogo.className = "text-sm md:text-base font-bold font-mono tracking-widest text-garage-red flex items-center gap-1.5 cursor-pointer hover:opacity-80 transition-opacity drop-shadow-md";
    dnaContainer?.classList.add("hidden");
    dnaContainer?.classList.remove("flex");
    carouselContainer?.classList.remove("hidden");
    carouselContainer?.classList.add("flex");
  }

  rpmText.className = isRetroSkin
    ? "text-[42px] font-156-gauge text-[#D1121C] smooth-value leading-none mt-1"
    : "text-4xl font-bold font-mono tracking-tight text-white smooth-value leading-none mt-0.5";

  $("hp-value").className = isRetroSkin
    ? "text-base font-156-gauge text-amber-500 smooth-value leading-none"
    : "text-base font-bold text-white smooth-value leading-none";
  $("torque-value").className = isRetroSkin
    ? "text-base font-156-gauge text-orange-500 smooth-value leading-none"
    : "text-base font-bold text-white smooth-value leading-none";

  updateGaugeArcColor();
  setDNAMode(currentMode);
}

function setDNAMode(mode) {
  currentMode = mode;
  ["dna-d", "dna-n", "dna-a"].forEach((id) => {
    const el = $(id);
    if (el) el.className = "w-8 h-8 rounded-full flex items-center justify-center text-xs font-serif-brand font-bold text-gray-500 hover:text-white transition-all duration-300";
  });
  const activeBtn = $(`dna-${mode.substring(0, 1)}`);
  const dnaLabel = $("dna-status-label");
  const dynamicTitle = $("dynamic-card-title");
  const dynamicIcon = $("dynamic-card-icon");

  if (mode === "dynamic") {
    activeBtn.className = "w-8 h-8 rounded-full flex items-center justify-center text-xs font-serif-brand font-bold text-white bg-[#D1121C] shadow-lg border border-red-500/20";
    dnaLabel.textContent = "DNA: Dynamic";
    dnaLabel.style.color = COLORS.alfaRed;
    dynamicTitle.textContent = "BOOST";
    dynamicIcon.className = "fa-solid fa-gauge-simple-high text-amber-500";
  } else if (mode === "natural") {
    activeBtn.className = "w-8 h-8 rounded-full flex items-center justify-center text-xs font-serif-brand font-bold text-white bg-zinc-700/60 border border-white/10";
    dnaLabel.textContent = "DNA: Natural";
    dnaLabel.style.color = isRetroSkin ? COLORS.alfaRed : COLORS.grayNatural;
    dynamicTitle.textContent = "INTAKE";
    dynamicIcon.className = "fa-solid fa-wind text-cyan-400";
  } else {
    activeBtn.className = "w-8 h-8 rounded-full flex items-center justify-center text-xs font-serif-brand font-bold text-white bg-blue-600 shadow-lg border border-blue-400/20";
    dnaLabel.textContent = "DNA: All Weather";
    dnaLabel.style.color = isRetroSkin ? COLORS.alfaRed : COLORS.coolBlue;
    dynamicTitle.textContent = "INTAKE";
    dynamicIcon.className = "fa-solid fa-wind text-cyan-400";
  }
  updateGaugeArcColor();
  renderUi();
}

function ingestTelemetry(t) {
  if (!t) return;
  pendingTelemetry = t;
}

function applyTelemetry(t) {
  data.rpm = t.rpm ?? data.rpm;
  data.speed = t.speed ?? data.speed;
  data.coolant = t.coolant ?? data.coolant;
  data.intake = t.intake ?? data.intake;
  data.baro = t.baro ?? data.baro ?? 100;
  data.map = t.map ?? data.map;
  data.throttle = t.throttle ?? data.throttle;
  data.pedal = t.pedal ?? data.pedal;
  data.timing = t.timing ?? data.timing;
  data.boost = t.boostBar ?? data.boost;

  if (isSimulation) {
    const t0 = performance.now();
    currentG.x = Math.sin(t0 / 600) * 0.45;
    currentG.y = (data.speed / 100) * 0.35 + (Math.sin(t0 / 900) > 0 ? 0.3 : -0.2);
    const mag = Math.hypot(currentG.x, currentG.y);
    if (mag > peakG) {
      peakG = mag;
      peakGCoords = { x: currentG.x, y: currentG.y };
    }
  }

  computeEngineDerived();

  if (data.rpm > peaks.rpm) peaks.rpm = data.rpm;
  if (data.speed > peaks.speed) peaks.speed = data.speed;
  if (data.coolant > peaks.coolant) peaks.coolant = data.coolant;
  if (currentMode === "dynamic") {
    if (data.boost > peaks.dynamic) peaks.dynamic = data.boost;
  } else if (data.intake > peaks.dynamic) {
    peaks.dynamic = data.intake;
  }
  if (data.hp > peaks.hp) peaks.hp = data.hp;
  if (data.torque > peaks.torque) peaks.torque = data.torque;
}

function renderUi() {
  const rpm = anim.rpm.val;
  const speed = anim.speed.val;
  const coolant = anim.coolant.val;
  const boost = anim.boost.val;
  const hp = anim.hp.val;
  const torque = anim.torque.val;
  const intake = anim.intake.val;

  $("rpm-value").textContent = Math.round(rpm);
  $("speed-value").textContent = Math.round(speed);
  $("coolant-value").textContent = Math.round(coolant);
  $("dynamic-card-value").textContent = currentMode === "dynamic" ? boost.toFixed(2) : Math.round(intake);
  $("lat-g-value").textContent = `${anim.gX.val.toFixed(2)} G`;
  $("long-g-value").textContent = `${anim.gY.val.toFixed(2)} G`;
  if (peakG > 0) $("peak-g-value").textContent = `${peakG.toFixed(2)} G`;

  $("gauge-arc").style.strokeDashoffset = `${534 - Math.min(rpm / 8000, 1) * 534}`;

  const flashOverlay = $("flash-overlay");
  const shiftIndicator = $("shift-indicator");
  const dialGlow = $("dial-glow");
  const rpmText = $("rpm-value");
  if (rpm > 6000) {
    dialGlow?.classList.add("redline-glow");
    if (currentMode === "dynamic") shiftIndicator?.classList.remove("hidden");
    flashOverlay?.classList.add("shift-flash-active");
    if (!isRetroSkin) rpmText?.classList.add("text-[#D1121C]");
  } else {
    dialGlow?.classList.remove("redline-glow");
    shiftIndicator?.classList.add("hidden");
    flashOverlay?.classList.remove("shift-flash-active");
    if (!isRetroSkin) rpmText?.classList.remove("text-[#D1121C]");
  }

  $("peak-speed").textContent = Math.round(peaks.speed);
  $("peak-coolant").textContent = Math.round(peaks.coolant);
  $("peak-dynamic").textContent = currentMode === "dynamic" ? peaks.dynamic.toFixed(2) : Math.round(peaks.dynamic);
  $("hp-value").textContent = Math.round(hp);
  $("torque-value").textContent = Math.round(torque);
  $("peak-hp").textContent = Math.round(peaks.hp);
  $("peak-torque").textContent = Math.round(peaks.torque);

  $("hp-bar").style.width = `${Math.min((hp / 220) * 100, 100)}%`;
  $("torque-bar").style.width = `${Math.min((torque / 350) * 100, 100)}%`;

  const bigBoostValue = $("big-boost-value");
  const bigBoostBarRect = $("big-boost-bar-rect");
  bigBoostValue.textContent = boost.toFixed(2);
  const pct = Math.min((boost / 1.5) * 100, 100);
  bigBoostBarRect?.setAttribute("width", `${pct}%`);
  if (boost < 1) {
    bigBoostBarRect?.setAttribute("fill", "url(#boost-grad-normal)");
    bigBoostValue.style.color = "#ffffff";
  } else if (boost < 1.3) {
    bigBoostBarRect?.setAttribute("fill", "#facc15");
    bigBoostValue.style.color = "#facc15";
  } else {
    bigBoostBarRect?.setAttribute("fill", "#dc2626");
    bigBoostValue.style.color = "#dc2626";
  }

  checkWarnings(coolant, boost);
}

function checkWarnings(coolant = data.coolant, boost = data.boost) {
  const now = Date.now();
  let isWarning = false;
  const coolantCard = $("coolant-card");
  const boostCard = $("big-boost-card");
  if (coolant >= 95) {
    coolantCard?.classList.add("warning-active");
    isWarning = true;
  } else coolantCard?.classList.remove("warning-active");

  if (boost >= 1.4) {
    boostCard?.classList.add("warning-active");
    isWarning = true;
  } else boostCard?.classList.remove("warning-active");

  if (isWarning && now - lastWarningTime > 2000) {
    playWarningBeeps();
    lastWarningTime = now;
  }
}

function drawGForceRadar() {
  if (!gCtx || !gCanvas) return;
  const w = gCanvas.width;
  const h = gCanvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const scale = cx / 0.8;

  gCtx.clearRect(0, 0, w, h);
  gCtx.strokeStyle = "rgba(255,255,255,0.06)";
  gCtx.lineWidth = 2;
  gCtx.beginPath();
  gCtx.arc(cx, cy, 0.5 * scale, 0, Math.PI * 2);
  gCtx.stroke();
  gCtx.beginPath();
  gCtx.arc(cx, cy, 1.0 * scale, 0, Math.PI * 2);
  gCtx.stroke();
  gCtx.moveTo(0, cy);
  gCtx.lineTo(w, cy);
  gCtx.moveTo(cx, 0);
  gCtx.lineTo(cx, h);
  gCtx.stroke();

  for (let i = 1; i < gHistory.length; i++) {
    gCtx.beginPath();
    gCtx.moveTo(cx + gHistory[i - 1].x * scale, cy - gHistory[i - 1].y * scale);
    gCtx.lineTo(cx + gHistory[i].x * scale, cy - gHistory[i].y * scale);
    const progress = i / gHistory.length;
    const opacity = progress ** 2 * 0.85;
    gCtx.strokeStyle = isRetroSkin
      ? `rgba(209,18,28,${opacity})`
      : currentMode === "dynamic"
        ? `rgba(209,18,28,${opacity})`
        : currentMode === "allweather"
          ? `rgba(59,130,246,${opacity})`
          : `rgba(34,211,238,${opacity})`;
    gCtx.lineWidth = 1.5 + progress * 4;
    gCtx.stroke();
  }

  if (peakG > 0.05) {
    let px = cx + peakGCoords.x * scale;
    let py = cy - peakGCoords.y * scale;
    px = Math.max(8, Math.min(w - 8, px));
    py = Math.max(8, Math.min(h - 8, py));
    gCtx.strokeStyle = "rgba(251,191,36,0.7)";
    gCtx.lineWidth = 2;
    gCtx.beginPath();
    gCtx.moveTo(px - 4, py - 4);
    gCtx.lineTo(px + 4, py + 4);
    gCtx.moveTo(px + 4, py - 4);
    gCtx.lineTo(px - 4, py + 4);
    gCtx.stroke();
    gCtx.beginPath();
    gCtx.arc(px, py, 4, 0, Math.PI * 2);
    gCtx.stroke();
  }

  const tx = anim.gX.val;
  const ty = anim.gY.val;
  let curX = cx + tx * scale;
  let curY = cy - ty * scale;
  curX = Math.max(8, Math.min(w - 8, curX));
  curY = Math.max(8, Math.min(h - 8, curY));
  gCtx.beginPath();
  gCtx.arc(curX, curY, 6, 0, Math.PI * 2);
  gCtx.fillStyle = isRetroSkin
    ? COLORS.alfaRed
    : currentMode === "dynamic"
      ? COLORS.alfaRed
      : currentMode === "allweather"
        ? COLORS.coolBlue
        : "#22D3EE";
  gCtx.fill();
}

function startGCanvas() {
  gCanvas = $("g-canvas");
  if (!gCanvas) return;
  gCtx = gCanvas.getContext("2d");
  drawGForceRadar();
}

function stopGCanvas() {
  /* G描画はエンジンループに統合 */
}

function handleMotion(event) {
  if (!event.accelerationIncludingGravity || isSimulation || !active) return;
  rawAcc.x = (event.accelerationIncludingGravity.y || 0) / 9.8;
  rawAcc.y = -(event.accelerationIncludingGravity.x || 0) / 9.8;
  if (gCalibrating) return;

  currentG.x = rawAcc.x - gOffset.x;
  currentG.y = rawAcc.y - gOffset.y;
  filteredG.x = currentG.x * LPF_ALPHA + filteredG.x * (1 - LPF_ALPHA);
  filteredG.y = currentG.y * LPF_ALPHA + filteredG.y * (1 - LPF_ALPHA);
  const mag = Math.hypot(filteredG.x, filteredG.y);
  if (mag > peakG) {
    peakG = mag;
    peakGCoords = { x: filteredG.x, y: filteredG.y };
    $("peak-g-value").textContent = `${peakG.toFixed(2)} G`;
  }
}

async function calibrateGForce() {
  if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
    try {
      if ((await DeviceMotionEvent.requestPermission()) === "granted" && !motionBound) {
        window.addEventListener("devicemotion", handleMotion, true);
        motionBound = true;
      }
    } catch {
      /* ignore */
    }
  } else if (!motionBound) {
    window.addEventListener("devicemotion", handleMotion, true);
    motionBound = true;
  }
  gCalibrating = true;
  setTimeout(() => {
    gOffset.x = rawAcc.x;
    gOffset.y = rawAcc.y;
    gCalibrating = false;
    peakG = 0;
    peakGCoords = { x: 0, y: 0 };
    filteredG = { x: 0, y: 0 };
  }, 600);
}

function startCsvLogging() {
  csvRows = [
    "Timestamp,RPM,Speed_kmh,Coolant_C,Intake_C,Baro_kPa,MAP_kPa,Boost_bar,Throttle_%,Pedal_%,Timing_deg,HP_PS,Torque_Nm,GLat,GLong",
  ];
  if (csvTimer) clearInterval(csvTimer);
  csvTimer = setInterval(() => {
    if (!active || isSimulation) return;
    const ts = new Date().toISOString();
    csvRows.push(
      `${ts},${Math.round(data.rpm)},${Math.round(data.speed)},${Math.round(data.coolant)},${Math.round(data.intake)},${data.baro},${data.map},${data.boost.toFixed(2)},${Math.round(data.throttle)},${Math.round(data.pedal)},${data.timing.toFixed(1)},${Math.round(data.hp)},${Math.round(data.torque)},${filteredG.x.toFixed(3)},${filteredG.y.toFixed(3)}`
    );
  }, 250);
}

function stopCsvLogging() {
  if (csvTimer) {
    clearInterval(csvTimer);
    csvTimer = null;
  }
}

function exportCSVLog() {
  if (csvRows.length <= 1) {
    logConsole("保存するCSVデータがありません。", "error");
    toast("CSVデータがありません");
    return;
  }
  const csvContent = csvRows.join("\n");
  const fileName = `GarageLog_Telemetry_${Date.now()}.csv`;
  try {
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const file = new File([blob], fileName, { type: "text/csv" });
    if (navigator.canShare?.({ files: [file] })) {
      navigator.share({ files: [file], title: "Telemetry Data", text: "Garage Log OBD" }).then(() => {
        logConsole("CSVを共有/保存しました。", "system");
        playAlertSound(1100, 0.1);
      });
      return;
    }
  } catch {
    /* fallback */
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csvContent], { type: "text/csv" }));
  a.download = fileName;
  a.click();
  logConsole("CSVをダウンロードしました。", "system");
  playAlertSound(1100, 0.1);
}

async function triggerBluetoothConnection() {
  if (!hasWebBluetooth()) {
    showBleWarning();
    return;
  }
  if (isSimulation) {
    try {
      await obd.connect();
      setConnectionUi("live");
      isSimulation = false;
      startCsvLogging();
      logConsole("Connected. Init complete.", "system");
      toast("OBDに接続しました");
      showGsensorModal();
    } catch (err) {
      logConsole(`Connect failed: ${err.message}`, "error");
      toast(err.message || "接続失敗");
    }
  } else {
    exportDebugLog();
    debugFullLogs = [];
    obd.disconnect();
    setConnectionUi("sim");
    isSimulation = true;
    stopCsvLogging();
    obd.startSimulation();
    logConsole("Disconnected. Demo resumed.", "system");
    toast("切断しました");
  }
}

function openSettings() {
  const state = getState();
  $("api-key-input").value = state.settings?.geminiApiKey || "";
  $("settings-modal").classList.remove("hidden");
}

function closeSettings() {
  $("settings-modal").classList.add("hidden");
}

function saveSettingsKey() {
  onSaveSettingsRef?.($("api-key-input").value.trim());
  closeSettings();
  logConsole("API Key saved.", "system");
  toast("APIキーを保存しました");
}

let onSaveSettingsRef = null;

function triggerDTCScan() {
  $("dtc-modal").classList.remove("hidden");
}

function closeDTCScan() {
  $("dtc-modal").classList.add("hidden");
  $("ai-response-area").classList.add("hidden");
}

function logToDTC(msg, type = "info") {
  const item = document.createElement("div");
  item.className = type === "error" ? "text-red-400 font-bold" : type === "success" ? "text-green-400" : "text-cyan-400";
  item.innerHTML = `<span>▶ ${msg}</span>`;
  const logArea = $("dtc-status-log");
  logArea.appendChild(item);
  logArea.parentElement.scrollTop = logArea.parentElement.scrollHeight;
  logConsole(`[DTC] ${msg}`, type === "error" ? "error" : "system");
}

async function startDTCScanProcess() {
  $("dtc-run-btn").classList.add("hidden");
  $("dtc-clear-btn").classList.add("hidden");
  $("dtc-ai-btn").classList.add("hidden");
  $("dtc-loading-area").classList.remove("hidden");
  $("dtc-status-log").innerHTML = "";
  $("ai-response-area").classList.add("hidden");

  const mode = obd.getMode();
  if (mode === "sim" || mode === "idle") {
    logToDTC("※未接続のためデモ診断を開始します");
    await new Promise((r) => setTimeout(r, 800));
    $("dtc-vin-code").textContent = "ZAR940000DEMO";
    displayDTCResult("P0300", "Random/Multiple Cylinder Misfire Detected", "複数シリンダーでの失火を検出。");
    displayDTCResult("U1701", "CAN Network S&S Control Unit", "S&S制御ユニットとの通信異常の可能性。");
    lastDtcs = ["P0300", "U1701"];
    $("dtc-loading-area").classList.add("hidden");
    $("dtc-clear-btn").classList.remove("hidden");
    $("dtc-run-btn").classList.remove("hidden");
    $("dtc-ai-btn").classList.remove("hidden");
    return;
  }

  try {
    logToDTC("ECU診断通信を初期化中...");
    const vin = await obd.readVin();
    if (vin?.vin) {
      $("dtc-vin-code").textContent = vin.vin;
      logToDTC(`VIN取得成功: ${vin.vin}`, "success");
    }
    const codes = await obd.readDtcs();
    lastDtcs = codes;
    $("dtc-loading-area").classList.add("hidden");
    const make = getState().vehicles?.find((v) => v.id === getState().activeVehicleId)?.make || "";
    await preloadDtcForMake(make);
    if (codes.length) {
      logToDTC(`DTCを ${codes.length} 件検出しました！`, "error");
      for (const code of codes) {
        const info = await lookupDtc(code, make);
        displayDTCResult(code, info.name, info.desc);
      }
      playAlertSound(320, 0.4);
    } else {
      logToDTC("システム正常 (No DTC Found)", "success");
      displayNormalResult();
    }
  } catch (err) {
    $("dtc-loading-area").classList.add("hidden");
    logToDTC(`診断中にエラー: ${err.message}`, "error");
  } finally {
    $("dtc-clear-btn").classList.remove("hidden");
    $("dtc-run-btn").classList.remove("hidden");
    $("dtc-ai-btn").classList.remove("hidden");
    $("dtc-run-btn").textContent = "RE-SCAN";
  }
}

async function clearDTCFaults() {
  if (obd.getMode() !== "live") return;
  $("dtc-clear-btn").classList.add("hidden");
  $("dtc-ai-btn").classList.add("hidden");
  logToDTC("ECUフォルト消去要求送信中 (Mode 04)...", "info");
  try {
    await obd.clearDtcs();
    $("dtc-status-log").innerHTML = "<div class='text-green-500 font-bold'>▶ ECUフォルト消去成功。</div>";
    $("dtc-vin-code").textContent = "---";
    lastDtcs = [];
    playAlertSound(1000, 0.15);
  } catch (err) {
    logToDTC(`消去失敗: ${err.message}`, "error");
  } finally {
    $("dtc-clear-btn").classList.remove("hidden");
    $("dtc-ai-btn").classList.remove("hidden");
  }
}

async function askGeminiMechanic() {
  const state = getState();
  const apiKey = state.settings?.geminiApiKey;
  if (!apiKey) {
    toast("設定でGemini APIキーを入力してください");
    openSettings();
    return;
  }
  const aiBtn = $("dtc-ai-btn");
  const aiArea = $("ai-response-area");
  const aiText = $("ai-response-text");
  aiBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> THINKING...';
  aiBtn.disabled = true;
  aiArea.classList.remove("hidden");
  aiText.textContent = "AIメカニックが分析しています...";
  try {
    const vehicle = state.vehicles?.find((v) => v.id === state.activeVehicleId);
    const text = await askGeminiAboutDtcs({ apiKey, codes: lastDtcs, vehicle, telemetry: data });
    aiText.innerHTML = text.replace(/\n/g, "<br>").replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  } catch (err) {
    aiText.innerHTML = `<span class="text-red-500">エラー: ${err.message}</span>`;
  } finally {
    aiBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> ASK AI';
    aiBtn.disabled = false;
  }
}

function displayDTCResult(code, name, info) {
  const result = document.createElement("div");
  result.className = "mt-2 p-2 bg-red-950/30 rounded border border-red-500/20";
  result.innerHTML = `<div class="text-red-500 font-extrabold flex justify-between"><span>❌ 異常検出 [${code}]</span> <span class="animate-pulse text-xs">WARNING</span></div><div class="text-white text-[9px] font-bold mt-1">${name}</div><div class="text-gray-400 text-[8px] mt-1 leading-relaxed border-t border-white/5 pt-1">${info}</div>`;
  $("dtc-status-log").appendChild(result);
}

function displayNormalResult() {
  const result = document.createElement("div");
  result.className = "mt-2 p-2 bg-green-950/30 rounded border border-green-500/20";
  result.innerHTML = `<div class="text-green-500 font-extrabold">✅ システム正常</div><div class="text-gray-400 text-[8px] mt-1 border-t border-white/5 pt-1">ECUに記録されているトラブルコードはありません。</div>`;
  $("dtc-status-log").appendChild(result);
}

function setPaused(paused) {
  pollPaused = paused;
  obd?.setPollPaused?.(paused);
  $("dashboard-root")?.classList.toggle("paused", paused);
}

export function openDashboard() {
  active = true;
  document.body.classList.add("dashboard-active");
  $("dashboard-root")?.classList.remove("paused");
  obd?.setPollPaused?.(false);
  applyScreenScale();
  startGCanvas();
  startUiPump();
  const mode = obd?.getMode?.() || "sim";
  setConnectionUi(mode);
  if (mode === "idle") {
    obd.startSimulation();
    setConnectionUi("sim");
  }
  const t = obd?.getTelemetry?.();
  if (t && Object.keys(t).length) applyTelemetry(t);
  syncAnimFromData();
  renderUi();
  logConsole("Dashboard active.", "system");
  setTimeout(() => window.scrollTo(0, 1), 300);
  if (!hasWebBluetooth()) {
    setTimeout(showBleWarning, 800);
  }
}

function syncAnimFromData() {
  for (const key of ["rpm", "speed", "boost", "hp", "torque", "coolant", "intake"]) {
    if (anim[key]) {
      anim[key].val = data[key] ?? anim[key].val;
      if (anim[key].vel != null) anim[key].vel = 0;
    }
  }
  anim.gX.val = isSimulation ? currentG.x : filteredG.x;
  anim.gY.val = isSimulation ? currentG.y : filteredG.y;
}

export function closeDashboard() {
  active = false;
  $("dashboard-root")?.classList.add("paused");
  stopGCanvas();
  stopUiPump();
  stopCsvLogging();
  document.body.classList.remove("dashboard-active");
  obd?.setPollPaused?.(false);
}

export function initDashboard({ obdClient, getAppState, showToast, onSaveSettings }) {
  obd = obdClient;
  getState = getAppState;
  toast = showToast || toast;
  onSaveSettingsRef = onSaveSettings;

  initStaffRoll();
  isRetroSkin = false;
  document.body.classList.remove("retro-bg");
  toggleRetroSkin();
  setDNAMode("natural");

  window.toggleRetroSkin = toggleRetroSkin;
  window.setDNAMode = setDNAMode;
  window.openSettings = openSettings;
  window.closeSettings = closeSettings;
  window.saveSettings = saveSettingsKey;
  window.triggerDTCScan = triggerDTCScan;
  window.closeDTCScan = closeDTCScan;
  window.startDTCScanProcess = startDTCScanProcess;
  window.clearDTCFaults = clearDTCFaults;
  window.askGeminiMechanic = askGeminiMechanic;
  window.triggerBluetoothConnection = triggerBluetoothConnection;
  window.exportCSVLog = exportCSVLog;
  window.calibrateGForce = calibrateGForce;
  window.closeBleWarning = closeBleWarning;
  window.copyAppUrl = copyAppUrl;
  window.skipGsensor = skipGsensor;
  window.enableGsensorAndCalibrate = enableGsensorAndCalibrate;
  window.clearConsoleLog = () => {
    const panel = $("console-logs-container");
    if (panel) panel.innerHTML = '<div class="text-green-500 opacity-60">Log cleared.</div>';
    debugFullLogs = [];
  };

  $("db-back-btn")?.addEventListener("click", () => {
    closeDashboard();
    document.querySelector('[data-nav="obd"]')?.click();
  });

  window.addEventListener("resize", applyScreenScale);
  document.addEventListener("visibilitychange", () => {
    if (!active) return;
    setPaused(document.hidden);
    if (!document.hidden) {
      startGCanvas();
      startUiPump();
    } else {
      stopGCanvas();
      stopUiPump();
    }
  });
}

export function onDashboardTelemetry(t) {
  if (!active) {
    applyTelemetry(t);
    return;
  }
  ingestTelemetry(t);
}

export function onDashboardStatus(mode) {
  const wasLive = lastObdMode === "live";
  lastObdMode = mode;

  if (mode === "live") isSimulation = false;
  if (mode === "sim") isSimulation = true;

  if (wasLive && (mode === "disconnected" || mode === "sim" || mode === "idle")) {
    exportDebugLog();
    debugFullLogs = [];
  }

  if (!active) return;
  setConnectionUi(mode);
  if (mode === "live") {
    startCsvLogging();
    showGsensorModal();
  }
  if (mode === "sim" || mode === "idle") stopCsvLogging();
}

export function onDashboardLog(msg, level) {
  const type = level === "warn" || level === "error" ? "error" : msg.startsWith(">") ? "tx" : /41[0-9A-F]{2}/i.test(msg) ? "rx" : "system";
  logConsole(msg, type);
}

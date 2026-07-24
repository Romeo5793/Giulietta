/** BLE ELM327 アダプタの既知 GATT プロファイル（調査資料 §4.1 準拠） */
import { decodeVin, parseVinFromObdResponse } from "./vin-decode.js?v=3";

const BLE_PROFILES = [
  {
    id: "ios-vlink",
    label: "IOS-Vlink / OBDLink",
    service: "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
    characteristic: "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f",
  },
  {
    id: "lelink-ffe0",
    label: "LELink / 汎用 FFE0",
    service: "0000ffe0-0000-1000-8000-00805f9b34fb",
    characteristic: "0000ffe1-0000-1000-8000-00805f9b34fb",
  },
  {
    id: "generic-fff0",
    label: "Generic FFF0",
    service: "0000fff0-0000-1000-8000-00805f9b34fb",
    characteristic: null,
  },
];

const OPTIONAL_SERVICE_UUIDS = BLE_PROFILES.map((p) => p.service);

const SCAN_FILTERS = [
  { namePrefix: "OBD" },
  { namePrefix: "obd" },
  { namePrefix: "ELM" },
  { namePrefix: "VEEPEAK" },
  { namePrefix: "Vgate" },
  { namePrefix: "IOS-Vlink" },
  { namePrefix: "Android-Vlink" },
  { namePrefix: "OBDLink" },
  { namePrefix: "LELink" },
  { namePrefix: "vLinker" },
  { services: ["0000ffe0-0000-1000-8000-00805f9b34fb"] },
  { services: ["0000fff0-0000-1000-8000-00805f9b34fb"] },
  { services: ["e7810a71-73ae-499d-8c15-faa9aef0c3f2"] },
];

const PID_MAP = {
  rpm: "010C",
  speed: "010D",
  coolant: "0105",
  intake: "010F",
  baro: "0133",
  map: "010B",
  throttle: "0111",
  pedal: "0149",
  timing: "010E",
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function decodePid(cmd, hexPayload) {
  const bytes = hexPayload.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  const nums = bytes.map((b) => parseInt(b, 16)).filter((n) => !Number.isNaN(n));
  if (cmd === "010C" && nums.length >= 2) return Math.round(((nums[0] * 256) + nums[1]) / 4);
  if (cmd === "010D" && nums.length >= 1) return nums[0];
  if (cmd === "0105" && nums.length >= 1) return nums[0] - 40;
  if (cmd === "010F" && nums.length >= 1) return nums[0] - 40;
  if (cmd === "0133" && nums.length >= 1) return nums[0];
  if (cmd === "010B" && nums.length >= 1) return nums[0];
  if (cmd === "0111" && nums.length >= 1) return Math.round((nums[0] * 100) / 255);
  if (cmd === "0149" && nums.length >= 1) return Math.round((nums[0] * 100) / 255);
  if (cmd === "010E" && nums.length >= 1) return nums[0] / 2 - 64;
  return null;
}

function enrichTelemetry(telemetry) {
  const baro = telemetry.baro ?? 100;
  if (telemetry.map != null) {
    telemetry.boostBar = Math.max(0, (telemetry.map - baro) / 100);
  }
  return telemetry;
}

function parseMode03(response) {
  const clean = response.replace(/\s+/g, "").toUpperCase();
  for (const prefix of ["43", "47", "4A"]) {
    const idx = clean.indexOf(prefix);
    if (idx < 0) continue;
    const data = clean.slice(idx + 2);
    const codes = [];
    for (let i = 0; i + 3 < data.length; i += 4) {
      const A = parseInt(data.slice(i, i + 2), 16);
      const B = parseInt(data.slice(i + 2, i + 4), 16);
      if (Number.isNaN(A) || Number.isNaN(B) || (A === 0 && B === 0)) continue;
      const type = ["P", "C", "B", "U"][(A & 0xc0) >> 6];
      const d1 = ((A & 0x30) >> 4).toString(16);
      const d2 = (A & 0x0f).toString(16);
      const d3 = ((B & 0xf0) >> 4).toString(16);
      const d4 = (B & 0x0f).toString(16);
      codes.push((type + d1 + d2 + d3 + d4).toUpperCase());
    }
    if (codes.length) return [...new Set(codes)];
  }
  return [];
}

function nextPollCmd(tick) {
  if (tick % 40 === 15) return "0105";
  if (tick % 40 === 30) return "010F";
  if (tick % 40 === 0) return "0133";
  if (tick % 10 === 5) return "010D";
  if (tick % 10 === 8) return "010E";
  const fast = tick % 4;
  if (fast === 0) return "010C";
  if (fast === 1) return "010B";
  if (fast === 2) return "0111";
  return "0149";
}

function pidKey(cmd) {
  return Object.entries(PID_MAP).find(([, v]) => v === cmd)?.[0];
}

export function createObdClient({ onLog, onTelemetry, onStatus }) {
  let device = null;
  let characteristic = null;
  let writeChar = null;
  let rxBuffer = "";
  let polling = false;
  let pollPaused = false;
  let simTimer = null;
  let mode = "idle";
  let pollTick = 0;
  let lastTelemetry = {};

  const log = (msg, level = "info") => onLog?.(msg, level);
  const status = (s) => onStatus?.(s);

  function emitTelemetry(patch) {
    lastTelemetry = enrichTelemetry({ ...lastTelemetry, ...patch });
    onTelemetry?.(lastTelemetry);
  }

  async function write(cmd) {
    if (!writeChar) throw new Error("未接続");
    const data = new TextEncoder().encode(cmd.endsWith("\r") ? cmd : `${cmd}\r`);
    if (writeChar.properties.writeWithoutResponse) {
      await writeChar.writeValueWithoutResponse(data);
    } else {
      await writeChar.writeValue(data);
    }
  }

  function onNotify(event) {
    const value = new TextDecoder().decode(event.target.value);
    rxBuffer += value;
  }

  async function waitForPrompt(timeoutMs = 2500) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (rxBuffer.includes(">") || rxBuffer.includes("OK") || rxBuffer.includes("NO DATA")) {
        const out = rxBuffer;
        rxBuffer = "";
        return out;
      }
      await sleep(40);
    }
    const out = rxBuffer;
    rxBuffer = "";
    return out;
  }

  async function sendAndWait(cmd, timeoutMs = 2500) {
    rxBuffer = "";
    await write(cmd);
    return waitForPrompt(timeoutMs);
  }

  async function initElm() {
    const seq = ["ATZ", "ATE0", "ATL0", "ATS0", "ATH0", "ATSP0"];
    for (const c of seq) {
      log(`> ${c}`);
      const res = await sendAndWait(c, 3000);
      log(res.trim() || "(empty)");
      await sleep(120);
    }
  }

  async function findCharsInService(service, characteristicUuid) {
    if (characteristicUuid) {
      const ch = await service.getCharacteristic(characteristicUuid);
      const canNotify = ch.properties.notify || ch.properties.indicate;
      const canWrite = ch.properties.write || ch.properties.writeWithoutResponse;
      if (canNotify && canWrite) return { notify: ch, writeable: ch };
      if (canNotify) return { notify: ch, writeable: ch };
      throw new Error("キャラクタリスティックが通知/書き込みに対応していません");
    }

    const chars = await service.getCharacteristics();
    let notify = null;
    let writeable = null;
    for (const ch of chars) {
      if (ch.properties.notify || ch.properties.indicate) notify = ch;
      if (ch.properties.write || ch.properties.writeWithoutResponse) writeable = ch;
    }
    if (notify && writeable) return { notify, writeable };
    if (notify && (notify.properties.write || notify.properties.writeWithoutResponse)) {
      return { notify, writeable: notify };
    }
    throw new Error("サービス内に送受信キャラクタリスティックが見つかりません");
  }

  async function findChars(server) {
    for (const profile of BLE_PROFILES) {
      try {
        const service = await server.getPrimaryService(profile.service);
        const pair = await findCharsInService(service, profile.characteristic);
        log(`GATTプロファイル: ${profile.label}`);
        return { ...pair, profile };
      } catch {
        /* 次のプロファイルを試す */
      }
    }

    const services = await server.getPrimaryServices();
    for (const service of services) {
      try {
        const pair = await findCharsInService(service, null);
        log(`GATTプロファイル: フォールバック (${service.uuid})`);
        return { notify: pair.notify, writeable: pair.writeable, profile: { label: "Unknown" } };
      } catch {
        /* continue */
      }
    }
    throw new Error("書き込み/通知キャラクタリスティックが見つかりません");
  }

  async function connect() {
    if (!navigator.bluetooth) {
      throw new Error("このブラウザは Web Bluetooth 非対応です（Chrome/Edge推奨）");
    }
    stopSimulation();
    status("scanning");
    log("BLE OBD を探しています…");

    device = await navigator.bluetooth.requestDevice({
      filters: SCAN_FILTERS,
      optionalServices: OPTIONAL_SERVICE_UUIDS,
    });

    device.addEventListener("gattserverdisconnected", () => {
      polling = false;
      mode = "idle";
      status("disconnected");
      log("切断されました", "warn");
    });

    const server = await device.gatt.connect();
    const { notify, writeable } = await findChars(server);
    characteristic = notify;
    writeChar = writeable;
    await characteristic.startNotifications();
    characteristic.addEventListener("characteristicvaluechanged", onNotify);

    status("connected");
    mode = "live";
    pollTick = 0;
    log(`接続: ${device.name || "BLE device"}`);
    await initElm();
    startPolling();
  }

  async function pollOnce() {
    pollTick += 1;
    const cmd = nextPollCmd(pollTick);
    const key = pidKey(cmd);
    try {
      const res = await sendAndWait(cmd, 1500);
      const hex = res.replace(/[^0-9A-Fa-f\s]/g, " ");
      const m = hex.toUpperCase().match(/41\s*[0-9A-F]{2}\s*((?:[0-9A-F]{2}\s*)+)/);
      const payload = m ? m[1] : "";
      const value = decodePid(cmd, payload);
      if (key && value != null) emitTelemetry({ [key]: value });
    } catch {
      /* 次サイクルで再試行 */
    }
  }

  async function startPolling() {
    if (polling) return;
    polling = true;
    while (polling && mode === "live") {
      if (pollPaused || document.hidden) {
        await sleep(500);
        continue;
      }
      await pollOnce();
      await sleep(80);
    }
  }

  function stopPolling() {
    polling = false;
  }

  function setPollPaused(paused) {
    pollPaused = paused;
  }

  async function readDtcs() {
    if (mode === "sim") return ["P0301", "P1062"];
    if (mode !== "live") throw new Error("先に接続してください");
    stopPolling();
    try {
      const all = [];
      for (const modeCmd of ["03", "07", "0A"]) {
        const res = await sendAndWait(modeCmd, 4000);
        log(res.trim());
        all.push(...parseMode03(res));
      }
      return [...new Set(all)];
    } finally {
      startPolling();
    }
  }

  async function clearDtcs() {
    if (mode === "sim") {
      log("デモ: DTCクリア相当");
      return true;
    }
    if (mode !== "live") throw new Error("先に接続してください");
    stopPolling();
    try {
      const res = await sendAndWait("04", 4000);
      log(res.trim());
      return true;
    } finally {
      startPolling();
    }
  }

  const DEMO_VIN = "ZARFA1234H1234567";

  async function waitForVinResponse(timeoutMs = 12000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const buf = rxBuffer.toUpperCase();
      if (buf.includes("NO DATA") || buf.includes("UNABLE TO CONNECT") || buf.includes("BUS INIT")) {
        const out = rxBuffer;
        rxBuffer = "";
        return out;
      }
      // Mode 09 のマルチフレーム応答は `>` まで待つ（途中の OK では返さない）
      if (buf.includes(">") && (buf.includes("49 02") || buf.includes("4902") || buf.includes("49  02"))) {
        const out = rxBuffer;
        rxBuffer = "";
        return out;
      }
      await sleep(50);
    }
    const out = rxBuffer;
    rxBuffer = "";
    return out;
  }

  async function sendAndWaitVin(cmd) {
    rxBuffer = "";
    await write(cmd);
    return waitForVinResponse();
  }

  function describeVinFailure(res) {
    const upper = String(res || "").toUpperCase();
    if (!upper.trim() || upper.trim() === ">") {
      return "応答が空でした。イグニッション ON（エンジン始動または ACC）で再試行してください。";
    }
    if (upper.includes("NO DATA")) {
      return "ECU が NO DATA を返しました。この車両は OBD 経由の VIN 読取に未対応の可能性があります。設定画面から手入力できます。";
    }
    if (upper.includes("UNABLE TO CONNECT") || upper.includes("BUS INIT")) {
      return "OBD バスに接続できません。アダプタの差し直し・エンジン ON で再試行してください。";
    }
    return "応答を解析できませんでした。ログの生データを確認するか、設定から VIN を手入力してください。";
  }

  async function readVin() {
    if (mode === "sim") {
      const decoded = decodeVin(DEMO_VIN);
      log(`デモ VIN: ${DEMO_VIN}`);
      return decoded;
    }
    if (mode !== "live") throw new Error("先に接続してください");
    stopPolling();
    await sleep(250);
    try {
      log("VIN読み取り (Mode 09 02)…");
      // マルチフレーム（ISO-TP）向け: ヘッダ表示・長文許可・タイムアウト延長
      for (const c of ["ATH1", "AT AL", "AT ST FF"]) {
        log(`> ${c}`);
        await sendAndWait(c, 3000);
        await sleep(80);
      }

      let res = await sendAndWaitVin("0902");
      log(res.trim().slice(0, 800) || "(empty)");

      let vin = parseVinFromObdResponse(res);
      if (!vin) {
        log("再試行 (0902)…", "warn");
        await sleep(400);
        res = await sendAndWaitVin("0902");
        log(res.trim().slice(0, 800) || "(empty)");
        vin = parseVinFromObdResponse(res);
      }

      await sendAndWait("ATH0", 3000);
      await sendAndWait("AT ST 32", 3000);

      if (!vin) {
        throw new Error(`VINを取得できませんでした。${describeVinFailure(res)}`);
      }
      const decoded = decodeVin(vin);
      log(`VIN: ${vin}`);
      return decoded;
    } finally {
      startPolling();
    }
  }

  function startSimulation() {
    disconnect(false);
    mode = "sim";
    pollTick = 0;
    status("sim");
    log("デモモード開始");
    let t = 0;
    simTimer = setInterval(() => {
      if (pollPaused || document.hidden) return;
      t += 0.05;
      const rpm = 3800 + Math.sin(t) * 3000;
      const speed = 40 + Math.sin(t) * 20;
      const coolant = 85 + Math.sin(t * 0.2) * 15;
      const boostBar = Math.max(0, Math.sin(t) * 1.6);
      const map = boostBar > 0 ? boostBar * 100 + 100 : 30 + (rpm / 8000) * 70;
      emitTelemetry({
        rpm: Math.round(rpm),
        speed: Math.round(speed),
        coolant: Math.round(coolant),
        intake: 24 + Math.round(Math.sin(t * 0.3) * 8),
        baro: 101,
        map: Math.round(map),
        throttle: boostBar > 1.2 ? 20 : Math.min(100, Math.round(50 + Math.sin(t) * 60)),
        pedal: rpm > 1500 ? Math.min(100, Math.round(50 + Math.sin(t) * 60)) : 0,
        timing: 15 + Math.sin(t) * 5,
        boostBar,
      });
    }, 100);
  }

  function stopSimulation() {
    if (simTimer) {
      clearInterval(simTimer);
      simTimer = null;
    }
  }

  function disconnect(notify = true) {
    stopPolling();
    stopSimulation();
    try {
      if (device?.gatt?.connected) device.gatt.disconnect();
    } catch {
      /* ignore */
    }
    device = null;
    characteristic = null;
    writeChar = null;
    mode = "idle";
    lastTelemetry = {};
    if (notify) {
      status("disconnected");
      log("切断");
    }
  }

  function getMode() {
    return mode;
  }

  function getTelemetry() {
    return { ...lastTelemetry };
  }

  return {
    connect,
    disconnect,
    startSimulation,
    readDtcs,
    clearDtcs,
    readVin,
    getMode,
    getTelemetry,
    setPollPaused,
  };
}

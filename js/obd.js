const SERVICE_UUIDS = [
  "0000fff0-0000-1000-8000-00805f9b34fb",
  "0000ffe0-0000-1000-8000-00805f9b34fb",
];

const PIDs = {
  rpm: "010C",
  speed: "010D",
  coolant: "0105",
  map: "010B",
  throttle: "0111",
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
  if (cmd === "010B" && nums.length >= 1) return nums[0];
  if (cmd === "0111" && nums.length >= 1) return Math.round((nums[0] * 100) / 255);
  return null;
}

function parseMode03(response) {
  const clean = response.replace(/\s+/g, "").toUpperCase();
  const idx = clean.indexOf("43");
  if (idx < 0) return [];
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
  return [...new Set(codes)];
}

export function createObdClient({ onLog, onTelemetry, onStatus }) {
  let device = null;
  let characteristic = null;
  let writeChar = null;
  let rxBuffer = "";
  let polling = false;
  let simTimer = null;
  let mode = "idle"; // idle | live | sim

  const log = (msg, level = "info") => onLog?.(msg, level);
  const status = (s) => onStatus?.(s);

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

  async function findChars(server) {
    const services = await server.getPrimaryServices();
    let notify = null;
    let writeable = null;
    for (const service of services) {
      const chars = await service.getCharacteristics();
      for (const ch of chars) {
        if (ch.properties.notify || ch.properties.indicate) notify = ch;
        if (ch.properties.write || ch.properties.writeWithoutResponse) writeable = ch;
      }
    }
    if (!notify || !writeable) throw new Error("書き込み/通知キャラクタリスティックが見つかりません");
    return { notify, writeable };
  }

  async function connect() {
    if (!navigator.bluetooth) {
      throw new Error("このブラウザは Web Bluetooth 非対応です（Chrome/Edge推奨）");
    }
    stopSimulation();
    status("scanning");
    log("BLE OBD を探しています…");

    device = await navigator.bluetooth.requestDevice({
      filters: [
        { namePrefix: "OBD" },
        { namePrefix: "obd" },
        { namePrefix: "ELM" },
        { namePrefix: "VEEPEAK" },
        { namePrefix: "Vgate" },
        { namePrefix: "IOS-Vlink" },
        { namePrefix: "Android-Vlink" },
      ],
      optionalServices: SERVICE_UUIDS,
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
    log(`接続: ${device.name || "BLE device"}`);
    await initElm();
    startPolling();
  }

  async function pollOnce() {
    const telemetry = {};
    for (const [key, pid] of Object.entries(PIDs)) {
      try {
        const res = await sendAndWait(pid, 1800);
        const hex = res.replace(/[^0-9A-Fa-f\s]/g, " ");
        // skip header echo: look for bytes after 41 XX
        const m = hex.toUpperCase().match(/41\s*[0-9A-F]{2}\s*((?:[0-9A-F]{2}\s*)+)/);
        const payload = m ? m[1] : "";
        telemetry[key] = decodePid(pid, payload);
      } catch {
        telemetry[key] = null;
      }
    }
    // MAP(kPa) を簡易ブースト表示用に残す
    if (telemetry.map != null) {
      telemetry.boostBar = Math.max(0, (telemetry.map - 100) / 100);
    }
    onTelemetry?.(telemetry);
  }

  async function startPolling() {
    if (polling) return;
    polling = true;
    while (polling && mode === "live") {
      await pollOnce();
      await sleep(200);
    }
  }

  function stopPolling() {
    polling = false;
  }

  async function readDtcs() {
    if (mode === "sim") {
      return ["P0301", "P1062"];
    }
    if (mode !== "live") throw new Error("先に接続してください");
    stopPolling();
    try {
      const res = await sendAndWait("03", 4000);
      log(res.trim());
      return parseMode03(res);
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

  function startSimulation() {
    disconnect(false);
    mode = "sim";
    status("sim");
    log("デモモード開始");
    let t = 0;
    simTimer = setInterval(() => {
      t += 1;
      const rpm = 850 + Math.round((Math.sin(t / 8) * 0.5 + 0.5) * 4200);
      const speed = Math.round((Math.sin(t / 14) * 0.5 + 0.5) * 110);
      const coolant = 78 + Math.round((Math.sin(t / 30) * 0.5 + 0.5) * 12);
      const map = 35 + Math.round((Math.sin(t / 10) * 0.5 + 0.5) * 120);
      onTelemetry?.({
        rpm,
        speed,
        coolant,
        map,
        throttle: Math.round((rpm - 850) / 45),
        boostBar: Math.max(0, (map - 100) / 100),
      });
    }, 200);
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
    if (notify) {
      status("disconnected");
      log("切断");
    }
  }

  function getMode() {
    return mode;
  }

  return {
    connect,
    disconnect,
    startSimulation,
    readDtcs,
    clearDtcs,
    getMode,
  };
}

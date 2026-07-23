import { lookupDtc } from "./dtc-dict.js";

export async function askGeminiAboutDtcs({ apiKey, codes, vehicleLabel, telemetry }) {
  if (!apiKey) throw new Error("Gemini APIキーが未設定です（設定タブ）");

  const details = codes
    .map((c) => {
      const d = lookupDtc(c);
      return `${c}: ${d.name} — ${d.desc}`;
    })
    .join("\n");

  const prompt = `あなたは Alfa Romeo Giulietta 1.4 MultiAir（コンペティツィオーネ / MT）に詳しい整備アドバイザーです。
断定しすぎず、安全に点検・整備工場へ相談すべき点も書いてください。日本語で、Markdownの短い箇条書き中心。

車両: ${vehicleLabel || "Giulietta 1.4"}
テレメトリ概要: ${JSON.stringify(telemetry || {})}
DTC:
${details || "(コードなし)"}

この状況で「優先して確認すること」を最大5つ。`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Geminiエラー: ${res.status} ${text.slice(0, 180)}`);
  }

  const data = await res.json();
  const text =
    data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n") ||
    "応答が空でした。";
  return text;
}

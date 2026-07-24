import { lookupDtc } from "./dtc-dict.js";

export async function askGeminiAboutDtcs({ apiKey, codes, vehicle, telemetry }) {
  if (!apiKey) throw new Error("Gemini APIキーが未設定です（設定タブ）");

  const label = [vehicle?.make, vehicle?.model, vehicle?.nickname, vehicle?.year]
    .filter(Boolean)
    .join(" / ");

  const details = (
    await Promise.all(
      codes.map(async (c) => {
        const d = await lookupDtc(c, vehicle?.make);
        const sev = ["情報", "軽度", "要整備", "即時確認"][d.severity] ?? "軽度";
        return `${c} [${sev}]: ${d.name} — ${d.desc}`;
      })
    )
  ).join("\n");

  const prompt = `あなたは自動車整備に詳しいアドバイザーです。車種は問いません。
断定しすぎず、安全に点検・整備工場へ相談すべき点も書いてください。日本語で、Markdownの短い箇条書き中心。

車両: ${label || "（未登録）"}
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
  return (
    data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n") || "応答が空でした。"
  );
}

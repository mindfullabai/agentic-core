/**
 * Capability vision (OCR / analisi immagine) — port generico da DietLogger-Agentic
 * (src/lib/gemini-vision.ts). Tool deterministico via REST, NON passa dall'endpoint
 * del chat agent. Default Gemini (gemini-flash-latest), fallback OpenAI gpt-4.1-mini.
 *
 * Richiede GEMINI_API_KEY (default) o OPENAI_API_KEY (fallback). Generalizzato:
 * non assume nessun dominio (etichette, piatti, documenti, screenshot…), il
 * chiamante passa systemPrompt + userInstruction.
 *
 * Zero dipendenze npm (solo fetch).
 */

const GEMINI_MODEL_DEFAULT = "gemini-flash-latest";

export type VisionBackend = "gemini" | "openai";

export interface VisionInput {
  imageUrl?: string;
  base64Data?: string;
  mimeType?: string;
}

/** Risolve i byte immagine in base64: da base64 diretto, data-URI, o URL remoto. */
export async function resolveImageBytes(
  imageUrl?: string,
  base64Data?: string,
  mimeType = "image/jpeg",
): Promise<{ data: string; mimeType: string }> {
  if (base64Data) return { data: base64Data, mimeType };
  if (!imageUrl) throw new Error("Nessuna immagine fornita.");
  const m = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (m) return { data: m[2], mimeType: m[1] };
  const res = await fetch(imageUrl, { headers: { "User-Agent": "agentic-core/0.1" } });
  if (!res.ok) throw new Error(`Download immagine fallito: HTTP ${res.status}`);
  const ct = res.headers.get("content-type") ?? mimeType;
  const buf = Buffer.from(await res.arrayBuffer());
  return { data: buf.toString("base64"), mimeType: ct.split(";")[0] };
}

/** Estrae il primo blocco JSON da un testo (gestisce ```json fences e testo extra). */
export function parseJsonFromText<T>(text: string): T {
  let json = text.trim();
  if (json.startsWith("```")) {
    json = json.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  }
  try {
    return JSON.parse(json) as T;
  } catch {
    const start = json.indexOf("{");
    const end = json.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(json.slice(start, end + 1)) as T;
    throw new Error("Nessun JSON valido nella risposta vision.");
  }
}

/** Analizza un'immagine con Gemini. Ritorna il testo grezzo (il chiamante parsa). */
export async function analyzeImageWithGemini(
  systemPrompt: string,
  userInstruction: string,
  opts: VisionInput,
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY non configurata — backend Gemini non disponibile.");
  const model = process.env.GEMINI_MODEL?.trim() || GEMINI_MODEL_DEFAULT;
  const img = await resolveImageBytes(opts.imageUrl, opts.base64Data, opts.mimeType ?? "image/jpeg");

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: img.mimeType, data: img.data } },
          { text: userInstruction },
        ],
      },
    ],
    generationConfig: { responseMimeType: "application/json" },
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
  if (!text) throw new Error("Gemini returned empty content");
  return text;
}

/** Fallback OpenAI (gpt-4.1-mini) vision. Ritorna il testo grezzo. */
export async function analyzeImageWithOpenAI(
  systemPrompt: string,
  userInstruction: string,
  opts: VisionInput,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY non configurata — fallback OpenAI non disponibile.");
  const imageUrl = opts.imageUrl
    ? opts.imageUrl
    : `data:${opts.mimeType ?? "image/jpeg"};base64,${opts.base64Data}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
            { type: "text", text: userInstruction },
          ],
        },
      ],
      max_tokens: 800,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  const content = data.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned empty content");
  return content;
}

/** Prova Gemini, poi fallback OpenAI. Ritorna { text, backend }. */
export async function analyzeImage(
  systemPrompt: string,
  userInstruction: string,
  opts: VisionInput,
): Promise<{ text: string; backend: VisionBackend }> {
  try {
    return { text: await analyzeImageWithGemini(systemPrompt, userInstruction, opts), backend: "gemini" };
  } catch {
    return { text: await analyzeImageWithOpenAI(systemPrompt, userInstruction, opts), backend: "openai" };
  }
}

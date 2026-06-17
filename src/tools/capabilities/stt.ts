/**
 * Capability STT (speech-to-text) — port generico da DietLogger-Agentic
 * (src/lib/transcribe.ts). Whisper di OpenAI via fetch REST: zero SDK, zero deps.
 *
 * Richiede OPENAI_API_KEY. Modello via WHISPER_MODEL (default whisper-1).
 */

const WHISPER_ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
const WHISPER_MODEL_DEFAULT = "whisper-1";

export interface TranscribeOptions {
  /** Nome file con estensione coerente col formato (es. "voice.ogg"). */
  filename?: string;
  /** MIME type dell'audio (es. "audio/ogg"). */
  mimeType?: string;
  /** Lingua attesa (ISO-639-1, es. "it") — migliora accuratezza e latenza. */
  language?: string;
}

/**
 * Trascrive un buffer audio in testo. Ritorna la stringa trascritta (trim).
 * Lancia se manca la key o l'API risponde con errore (il chiamante gestisce).
 */
export async function transcribeAudio(
  audio: Buffer | Uint8Array,
  opts: TranscribeOptions = {},
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY non configurata — trascrizione audio non disponibile.");
  const model = process.env.WHISPER_MODEL?.trim() || WHISPER_MODEL_DEFAULT;

  const form = new FormData();
  // Copia in un ArrayBuffer "puro" per soddisfare il tipo BlobPart.
  const ab = new ArrayBuffer(audio.byteLength);
  new Uint8Array(ab).set(audio);
  const blob = new Blob([ab], { type: opts.mimeType ?? "audio/ogg" });
  form.append("file", blob, opts.filename ?? "voice.ogg");
  form.append("model", model);
  if (opts.language) form.append("language", opts.language);

  const res = await fetch(WHISPER_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Whisper API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { text?: string };
  const text = (data.text ?? "").trim();
  if (!text) throw new Error("Whisper ha restituito una trascrizione vuota.");
  return text;
}

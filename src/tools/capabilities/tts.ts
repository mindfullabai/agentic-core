/**
 * Capability TTS — ElevenLabs via REST. NUOVA (riusa il pattern della skill
 * tts-cli di Mario). Zero dipendenze (fetch). Ritorna l'audio come Buffer.
 *
 * Richiede ELEVENLABS_API_KEY. Voce e modello configurabili (default: voce IT
 * impostata via env ELEVENLABS_VOICE_ID, modello eleven_multilingual_v2).
 */

const TTS_MODEL_DEFAULT = "eleven_multilingual_v2";
const OUTPUT_FORMAT_DEFAULT = "mp3_44100_128";

export interface TtsOptions {
  /** Voice ID ElevenLabs. Default da ELEVENLABS_VOICE_ID. */
  voiceId?: string;
  /** Modello TTS. Default eleven_multilingual_v2. */
  model?: string;
  /** Formato output (es. mp3_44100_128). */
  outputFormat?: string;
  /** Stabilità/similarity (0..1). */
  stability?: number;
  similarityBoost?: number;
}

/** Sintetizza `text` in audio. Ritorna il Buffer dell'audio (formato richiesto). */
export async function synthesizeSpeech(text: string, opts: TtsOptions = {}): Promise<Buffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY non configurata — TTS non disponibile.");
  const voiceId = opts.voiceId ?? process.env.ELEVENLABS_VOICE_ID?.trim();
  if (!voiceId) throw new Error("Voice ID mancante: passa `voiceId` o imposta ELEVENLABS_VOICE_ID.");

  const model = opts.model ?? TTS_MODEL_DEFAULT;
  const outputFormat = opts.outputFormat ?? OUTPUT_FORMAT_DEFAULT;

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${outputFormat}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
      body: JSON.stringify({
        text,
        model_id: model,
        voice_settings: {
          stability: opts.stability ?? 0.5,
          similarity_boost: opts.similarityBoost ?? 0.75,
        },
      }),
    },
  );
  if (!res.ok) throw new Error(`ElevenLabs TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

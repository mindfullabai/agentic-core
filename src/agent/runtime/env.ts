/**
 * Loader env model-agnostic — port generico da DietLogger-Agentic (src/agent/env.ts).
 *
 * Cabla il backend del Claude Agent SDK: Anthropic nativo di default, oppure un
 * endpoint OpenAI-compatible (es. Qwen su DashScope, validato in DietLogger 13-14
 * Jun 2026) impostando ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_MODEL.
 *
 * Il Claude Agent SDK spawna un sottoprocesso che eredita process.env quando
 * l'opzione `env` è omessa: basta che le variabili siano in process.env perché
 * l'agente parli col backend scelto.
 *
 * MAI loggare la key in chiaro (usa maskSecret).
 */
import { config as loadDotenv } from "dotenv";

let loaded = false;

export interface ModelConfig {
  /** Endpoint API. Undefined = Anthropic nativo (default SDK). */
  baseUrl?: string;
  /** Token di autenticazione — non esporlo mai in log. */
  authToken?: string;
  /** Nome modello. */
  model: string;
}

/**
 * Carica un file .env una sola volta (sviluppo locale). Idempotente.
 * In deploy il file di solito non esiste: le env arrivano dall'ambiente, quindi
 * l'assenza del file NON è un errore. dotenv non sovrascrive env già presenti.
 *
 * @param path percorso del file .env da caricare (best-effort). Default: ".env".
 */
export function loadEnv(path = ".env"): void {
  if (loaded) return;
  loadDotenv({ path });
  loaded = true;
}

/**
 * Ritorna la config del modello dalle env.
 *
 * - Anthropic nativo: basta ANTHROPIC_MODEL (baseUrl/authToken gestiti dall'SDK
 *   via ANTHROPIC_API_KEY standard) → qui baseUrl/authToken restano undefined.
 * - Endpoint OpenAI-compatible (Qwen ecc.): richiede ANTHROPIC_BASE_URL +
 *   ANTHROPIC_AUTH_TOKEN; se uno dei due è presente, si pretende anche l'altro.
 *
 * `modelOverride` forza un modello ignorando ANTHROPIC_MODEL (usato dal tick:
 * comporre 2 frasi → un modello cheap basta).
 */
export function getModelConfig(modelOverride?: string, defaultModel = "claude-sonnet-4-6"): ModelConfig {
  const baseUrl = process.env.ANTHROPIC_BASE_URL?.trim() || undefined;
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN?.trim() || undefined;
  const model = modelOverride?.trim() || process.env.ANTHROPIC_MODEL?.trim() || defaultModel;

  // Endpoint custom: baseUrl e authToken vanno insieme.
  if ((baseUrl && !authToken) || (!baseUrl && authToken)) {
    throw new Error(
      "[env] ANTHROPIC_BASE_URL e ANTHROPIC_AUTH_TOKEN vanno impostati insieme per un endpoint custom.",
    );
  }

  // Guard soft noto da DietLogger: l'endpoint coding-intl dà 401 con key pay-as-you-go.
  if (baseUrl?.includes("coding-intl")) {
    throw new Error(
      "[env] ANTHROPIC_BASE_URL punta a coding-intl (Coding Plan) → 401 con key pay-as-you-go. " +
        "Usa dashscope-intl.aliyuncs.com/apps/anthropic.",
    );
  }

  return { baseUrl, authToken, model };
}

/** Maschera un segreto per logging sicuro: mostra solo prefisso e lunghezza. */
export function maskSecret(secret: string): string {
  if (secret.length <= 8) return "***";
  return `${secret.slice(0, 6)}…(${secret.length} chars)`;
}

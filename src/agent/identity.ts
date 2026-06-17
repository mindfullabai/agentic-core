/**
 * AgentIdentity — identità di prima classe di un agente: nome, persona, tono,
 * avatar. Generalizza ciò che in DietLogger era hardcoded ("Nina").
 *
 * - `persona` confluisce nel system prompt (vedi buildSystemPrompt).
 * - `name`/`description` vengono applicati al bot Telegram al boot (grammy
 *   setMyName/setMyDescription). L'avatar foto NON è settabile via grammy →
 *   va caricato una tantum su BotFather; `avatar` qui è un riferimento (per UI
 *   web / documentazione), non viene pushato a Telegram.
 */

export interface AgentIdentity {
  /** Nome dell'agente (es. "Alita", "Nina"). Diventa il bot name su Telegram. */
  name: string;
  /** Ruolo/identità breve (es. "tech partner di Mario"). */
  role?: string;
  /** Blocco persona completo iniettato nel system prompt (tono, stile, regole). */
  persona: string;
  /** Descrizione bot (Telegram setMyDescription, max 512). */
  description?: string;
  /** Descrizione breve (Telegram setMyShortDescription, max 120). */
  shortDescription?: string;
  /** Riferimento all'avatar (path/url) — per UI web. Telegram: via BotFather. */
  avatar?: string;
}

/**
 * Regole di formato per il canale Telegram, da appendere alla persona di un
 * agente conversazionale. Telegram NON rende `##` header né tabelle markdown
 * `| --- |` (appaiono come testo grezzo) → l'agente deve evitarli. Generico:
 * vale per qualsiasi agente su Telegram.
 */
export const TELEGRAM_FORMAT_RULES = [
  "## Formato risposte (canale Telegram)",
  "Rispondi in testo adatto a Telegram:",
  "- Usa *grassetto* (UN asterisco per lato) per evidenziare. NIENTE doppio asterisco.",
  "- Usa liste con trattino `- `.",
  "- NON usare intestazioni markdown `#`/`##` (Telegram le mostra come testo grezzo).",
  "- NON usare tabelle markdown `| --- |` (Telegram NON le renderizza): usa una lista.",
  "- Sii conciso: messaggi lunghi vengono spezzati.",
].join("\n");

/** Bot grammy minimale (tipato lasco per non dipendere dai tipi grammy). */
interface BotLike {
  api: {
    setMyName?: (name: string) => Promise<unknown>;
    setMyDescription?: (description: string) => Promise<unknown>;
    setMyShortDescription?: (shortDescription: string) => Promise<unknown>;
  };
}

/**
 * Applica nome/descrizione dell'identità al bot Telegram (best-effort: errori
 * di rate-limit o "not modified" non devono bloccare il boot).
 */
export async function applyIdentityToBot(bot: BotLike, identity: AgentIdentity): Promise<void> {
  try {
    await bot.api.setMyName?.(identity.name);
  } catch (e) {
    console.warn("[identity] setMyName fallito:", e instanceof Error ? e.message : e);
  }
  if (identity.description) {
    try {
      await bot.api.setMyDescription?.(identity.description);
    } catch (e) {
      console.warn("[identity] setMyDescription fallito:", e instanceof Error ? e.message : e);
    }
  }
  if (identity.shortDescription) {
    try {
      await bot.api.setMyShortDescription?.(identity.shortDescription);
    } catch (e) {
      console.warn("[identity] setMyShortDescription fallito:", e instanceof Error ? e.message : e);
    }
  }
}

/**
 * summarizeSession — compressione della memoria episodica via LLM cheap.
 *
 * Port generico da DietLogger-Agentic (src/agent/conversation-memory.ts).
 * Quando una conversazione riparte dopo inattività, comprime i messaggi non
 * ancora coperti da un summary in un ConversationSummary, così la prossima
 * sessione parte con un contesto sintetico invece dell'intero storico.
 *
 * Usa il MemoryStore esistente (getLastSummaryTo / getMessagesSince / createSummary)
 * e composeOnce per la chiamata LLM.
 */
import { composeOnce } from "../agent/runtime/query.js";
import type { MemoryStore } from "./store.js";

export interface SummarizeOptions {
  /** Soglia minima di messaggi per generare un summary. Default 4. */
  minMessages?: number;
  /** Modello cheap per il summary. */
  model?: string;
  defaultModel?: string;
  clientApp?: string;
  /** Prompt di summary. {transcript} viene sostituito. Default fattuale. */
  promptTemplate?: string;
  /** Nomi per il transcript (chi è user / assistant). */
  userLabel?: string;
  assistantLabel?: string;
}

const DEFAULT_PROMPT =
  "Riassumi questa conversazione in 3-5 frasi. Cattura: cosa è stato fatto/deciso, " +
  "preferenze o vincoli emersi, e questioni rimaste in sospeso. Sii sintetico e " +
  "fattuale: serve come memoria per la prossima conversazione.\n\n{transcript}";

/**
 * Comprime i messaggi non ancora summarizzati per `userId`. No-op se sotto soglia.
 * Best-effort: un errore non deve rompere il flusso conversazionale.
 */
export async function summarizeSession(
  store: MemoryStore,
  userId: string,
  opts: SummarizeOptions = {},
): Promise<void> {
  try {
    const lastTo = await store.getLastSummaryTo(userId);
    const messages = await store.getMessagesSince(userId, lastTo ?? undefined);
    const minMessages = opts.minMessages ?? 4;
    if (messages.length < minMessages) return;

    const uLabel = opts.userLabel ?? "Utente";
    const aLabel = opts.assistantLabel ?? "Assistente";
    const transcript = messages
      .map((m) => `${m.role === "user" ? uLabel : aLabel}: ${m.text}`)
      .join("\n")
      .slice(0, 12000);

    const prompt = (opts.promptTemplate ?? DEFAULT_PROMPT).replace("{transcript}", transcript);
    const summary = await composeOnce(prompt, {
      model: opts.model,
      defaultModel: opts.defaultModel,
      clientApp: opts.clientApp,
    });
    if (!summary.trim()) return;

    await store.createSummary(userId, {
      summary: summary.trim(),
      fromAt: messages[0].createdAt,
      toAt: messages[messages.length - 1].createdAt,
      messageCount: messages.length,
      createdAt: new Date(),
    });
  } catch (err) {
    console.warn("[memory] summarize fallito:", err instanceof Error ? err.message : err);
  }
}

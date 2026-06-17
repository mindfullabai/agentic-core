/**
 * Tool context + helper risultato — port generico da DietLogger-Agentic
 * (src/tools/types.ts), de-accoppiato da Prisma.
 *
 * Convenzioni (invariate dal pattern DietLogger):
 *  - Input schema: oggetto di shape Zod (NON `z.object(...)`) — l'SDK lo avvolge.
 *  - Output: SEMPRE `jsonResult(...)` → blocco testo con JSON serializzato, così
 *    l'LLM riceve dati strutturati e deterministici.
 *  - Errori di dominio: `jsonError(...)` invece di `throw`, così l'agente legge
 *    il motivo e ritenta.
 *  - `userId`: passato via ToolContext alla factory, MAI come argomento del tool.
 *
 * Differenza dal DietLogger: niente `db: PrismaClient` hardcoded. Il contesto è
 * generico — un MemoryStore opzionale + `deps` tipizzato dall'agente per le sue
 * dipendenze specifiche (client DB, MCP client, API client…).
 */
import type { MemoryStore } from "../memory/store.js";

/**
 * Contesto iniettato in ogni tool al momento della registrazione.
 * `Deps` permette all'agente di tipizzare le proprie dipendenze specifiche.
 */
export interface ToolContext<Deps = Record<string, unknown>> {
  /** Utente corrente — risolto dal canale, mai dall'LLM. */
  userId: string;
  /** Memoria conversazione (opzionale: non tutti i tool ne hanno bisogno). */
  store?: MemoryStore;
  /** Dipendenze specifiche dell'agente (client DB, API client, …). */
  deps?: Deps;
}

/**
 * Forma del risultato che l'Agent SDK si aspetta da un tool handler.
 * L'index signature ricalca CallToolResult per l'assegnabilità diretta.
 */
export interface SdkToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

/** Avvolge un payload come JSON in un risultato tool (successo). */
export function jsonResult(payload: unknown): SdkToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

/** Errore di dominio leggibile dall'agente. Niente throw. */
export function jsonError(message: string, extra?: Record<string, unknown>): SdkToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message, ...extra }, null, 2) }],
    isError: true,
  };
}

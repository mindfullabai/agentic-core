/**
 * MemoryStore — strato di memoria episodica durevole, generico e pluggable.
 *
 * Astrae il pattern di DietLogger-Agentic (src/agent/conversation-memory.ts), che
 * era accoppiato a PrismaClient. Il core non impone un DB: un agente semplice usa
 * FileStore (JSON, zero-dep), uno con storage relazionale usa PrismaMemoryStore.
 *
 * La sessione dell'Agent SDK resta working memory effimera; questo è lo strato
 * episodico che sopravvive ai restart + base per debug/audit.
 */

export type MessageRole = "user" | "assistant";

export interface StoredMessage {
  role: MessageRole;
  text: string;
  toolsUsed: string[];
  channel: string;
  createdAt: Date;
}

export interface StoredSummary {
  summary: string;
  fromAt: Date;
  toAt: Date;
  messageCount: number;
  createdAt: Date;
}

/**
 * Contratto minimo di memoria conversazionale. Tutte le implementazioni sono
 * per-utente (bucket isolato per `userId`).
 */
export interface MemoryStore {
  /** Storicizza un turno. Best-effort: un errore non deve rompere la chat. */
  appendMessage(
    userId: string,
    role: MessageRole,
    text: string,
    toolsUsed?: string[],
    channel?: string,
  ): Promise<void>;

  /** Ultimo riassunto disponibile, da iniettare nel context block. */
  getLastSummary(userId: string): Promise<string | null>;

  /** Timestamp dell'ultimo summary (per sapere da dove riprendere). */
  getLastSummaryTo(userId: string): Promise<Date | null>;

  /** Messaggi creati dopo `since` (o tutti se since assente), in ordine cronologico. */
  getMessagesSince(userId: string, since?: Date): Promise<StoredMessage[]>;

  /** Salva un riassunto di sessione. */
  createSummary(userId: string, summary: StoredSummary): Promise<void>;
}

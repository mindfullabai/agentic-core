/**
 * SessionManager — continuità multi-turn per agenti conversazionali.
 *
 * Estratto dal pattern di DietLogger-Agentic (src/agent/channels/telegram.ts):
 *  - Map conversationId → sessionId dell'Agent SDK (working memory, resume).
 *  - idle-reset: dopo N minuti di inattività la sessione è "nuova" → si azzera
 *    il resume e si scatena un hook `onIdle` (tipicamente: summarize episodica).
 *
 * La sessione SDK vive in RAM (si perde ai restart); la memoria durevole è il
 * MemoryStore. Questo gestisce solo la continuità "calda".
 */

export interface SessionManagerOptions {
  /** Minuti di inattività dopo cui la sessione è considerata nuova. Default 45. */
  idleMinutes?: number;
  /** Hook invocato quando una conversazione riparte dopo idle (best-effort). */
  onIdle?: (conversationId: string) => void | Promise<void>;
}

export class SessionManager {
  private readonly sessions = new Map<string, string>(); // convId → sessionId
  private readonly lastTurnAt = new Map<string, number>(); // convId → epoch ms
  private readonly idleMs: number;
  private readonly onIdle?: (id: string) => void | Promise<void>;

  constructor(opts: SessionManagerOptions = {}) {
    this.idleMs = (opts.idleMinutes ?? 45) * 60_000;
    this.onIdle = opts.onIdle;
  }

  /**
   * Apre un turno: ritorna il sessionId da riusare (o undefined se nuova sessione).
   * Se è passato troppo tempo, azzera la sessione e scatena onIdle.
   * `now` iniettabile per test.
   */
  beginTurn(conversationId: string, now = Date.now()): { resume?: string } {
    const last = this.lastTurnAt.get(conversationId);
    const isNew = !last || now - last > this.idleMs;
    if (isNew) {
      this.sessions.delete(conversationId);
      if (last !== undefined && this.onIdle) {
        void Promise.resolve(this.onIdle(conversationId)).catch(() => {});
      }
    }
    this.lastTurnAt.set(conversationId, now);
    return { resume: this.sessions.get(conversationId) };
  }

  /** Registra il sessionId restituito dall'SDK a fine turno. */
  endTurn(conversationId: string, sessionId?: string): void {
    if (sessionId) this.sessions.set(conversationId, sessionId);
  }

  /** Azzera manualmente una sessione (es. comando /reset). */
  reset(conversationId: string): void {
    this.sessions.delete(conversationId);
    this.lastTurnAt.delete(conversationId);
  }
}

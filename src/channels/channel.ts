/**
 * Channel — astrazione del trasporto di messaggi tra agente e utente.
 *
 * Disaccoppia il runtime agentico dal mezzo concreto (Telegram, push, file,
 * stdout). Un agente proattivo "always-on" ha bisogno solo di `send`; un agente
 * conversazionale implementa anche `receive`/`onMessage`.
 *
 * Estratto generalizzando il pattern di DietLogger-Agentic (Telegram era cablato
 * direttamente nel loop): qui il loop dipende dall'interfaccia, non da grammy.
 */

/**
 * Catena di stato di un turno conversazionale: un unico messaggio che cresce come
 * checklist. `thinking()` mostra un header effimero ("⏳ Sto ragionando…");
 * `step(id, label)` aggiunge una riga "🔧 label…" in corso; `done(id, ok)` la
 * marca "✓ label" (o "✗ label" se ok=false). A fine turno il canale decide se
 * lasciare la checklist nello storico (vedi reply): l'header effimero sparisce
 * sempre, le righe done restano se ci sono stati ≥2 step.
 */
export interface StatusChain {
  /** Header effimero iniziale ("sto ragionando…"). Idempotente. */
  thinking(): Promise<void>;
  /** Aggiunge uno step in corso. `id` lega lo start al suo done. */
  step(id: string, label: string): Promise<void>;
  /** Marca uno step come concluso (ok=true → ✓, ok=false → ✗). */
  done(id: string, ok: boolean): Promise<void>;
}

export interface InboundMessage {
  /** Utente sorgente (id risolto dal canale, es. chat_id Telegram come stringa). */
  userId: string;
  /** Testo del messaggio (audio/foto sono già normalizzati a testo dal canale). */
  text: string;
  /** Metadati opzionali specifici del canale. */
  meta?: Record<string, unknown>;
  /**
   * Aggiorna un indicatore di stato effimero ("sto ragionando…", "uso X").
   * Fornito dai canali conversazionali; assente sui canali solo-uscita.
   * @deprecated Preferisci `status` (catena di step). Mantenuto per retrocompat.
   */
  setStatus?: (text: string) => Promise<void>;
  /**
   * Catena di stato a step (checklist crescente). Fornita dai canali
   * conversazionali che la supportano (es. Telegram); assente altrove.
   */
  status?: StatusChain;
  /** Invia la risposta finale in questa conversazione (chunked dal canale). */
  reply?: (text: string) => Promise<void>;
}

export type InboundHandler = (msg: InboundMessage) => Promise<void>;

export interface Channel {
  /** Nome del canale (usato nel gate `noisy` e nei log). Es. "telegram", "file". */
  readonly name: string;
  /** True se il canale è "rumoroso" (notifica attiva) → soggetto a quiet hours. */
  readonly noisy: boolean;

  /** Invia un messaggio a un utente. */
  send(userId: string, text: string): Promise<void>;

  /**
   * Registra un handler per i messaggi in arrivo e avvia l'ascolto (se il canale
   * è conversazionale). I canali solo-uscita (push/file) lasciano questo no-op.
   */
  onMessage?(handler: InboundHandler): void;

  /** Avvia il canale (es. long polling). No-op per canali solo-uscita. */
  start?(): Promise<void>;

  /** Ferma il canale e rilascia risorse. */
  stop?(): Promise<void>;

  /**
   * Auto-claim ownership: invocato al primo contatto di un nuovo utente. Permette
   * a un agente single-owner di catturare l'id del primo che scrive `/start`.
   * Ritorna true se l'utente è ammesso, false se rifiutato.
   */
  onFirstContact?(userId: string, meta?: Record<string, unknown>): Promise<boolean>;
}

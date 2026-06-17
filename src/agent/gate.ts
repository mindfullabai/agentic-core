/**
 * Gate anti-spam deterministico — port generico da DietLogger-Agentic
 * (src/agent/policy.ts). Zero dipendenze (no Prisma, no logger).
 *
 * Guardia anti-fatigue da invocare PRIMA di ogni messaggio proattivo. Ogni
 * capability che vuole spingere un messaggio passa da `checkGate(...)`; se la
 * consegna avviene, registra l'evento con `recordDelivery(...)` così cooldown e
 * cap settimanale si aggiornano.
 *
 * Stato IN-MEMORY:
 *  - cooldown per `patternKey`  → stesso pattern non rispara entro `cooldownMs`.
 *  - cap settimanale per utente → max `maxPerWeek` messaggi/settimana.
 *  - quiet hours                → i canali "rumorosi" rispettano la fascia.
 *  - pausa globale via env      → escape-hatch operatore (`AGENT_PAUSED=1`).
 *
 * `now` è iniettabile per rendere i test deterministici.
 */

export type GateReason = "global_pause" | "quiet_hours" | "cooldown" | "weekly_cap";

export interface GateDecision {
  allow: boolean;
  /** Motivo del blocco quando `allow=false`. */
  reason?: GateReason;
  /** Timestamp (ms epoch) da cui ritentare, quando bloccato per cooldown. */
  retryAfter?: number;
}

export interface GateOptions {
  /** ms tra due invii dello stesso pattern. Default 6h. */
  cooldownMs?: number;
  /** Fascia di silenzio [start, end) in ore locali. Default 22→7. */
  quietHours?: { start: number; end: number };
  /** Tetto di messaggi per settimana per utente. Default 14 (~2/giorno). */
  maxPerWeek?: number;
  /** Se true, il canale rispetta le quiet hours. Default true. */
  noisy?: boolean;
}

export interface GateCheckInput extends GateOptions {
  /** Capability che vuole inviare (es. "proactive_suggestion"). */
  capability: string;
  /** Chiave di dedup: lo stesso pattern non rispara entro il cooldown. */
  patternKey?: string;
  /** Utente destinatario (bucket di cooldown/cap). Default: bucket globale. */
  userId?: string;
  /** Orario di riferimento — iniettabile per test deterministici. */
  now?: Date;
}

export const COOLDOWN_MS_DEFAULT = 6 * 60 * 60 * 1000; // 6h
export const QUIET_HOURS_DEFAULT = { start: 22, end: 7 }; // 22:00 – 07:00
export const MAX_PER_WEEK_DEFAULT = 14; // ~2/giorno

const cooldownStore = new Map<string, number>();
const weeklyCounter = new Map<string, { weekStart: number; count: number }>();
const DEFAULT_USER = "_global";

/**
 * Verifica se `capability` può inviare ORA. Non muta lo stato:
 * dopo una consegna effettiva chiama `recordDelivery(...)`.
 */
export function checkGate(input: GateCheckInput): GateDecision {
  if (process.env.AGENT_PAUSED === "1") {
    return { allow: false, reason: "global_pause" };
  }

  const now = input.now ?? new Date();
  const userId = input.userId ?? DEFAULT_USER;
  const cooldownMs = input.cooldownMs ?? COOLDOWN_MS_DEFAULT;
  const quiet = input.quietHours ?? QUIET_HOURS_DEFAULT;
  const maxPerWeek = input.maxPerWeek ?? MAX_PER_WEEK_DEFAULT;
  const noisy = input.noisy ?? true;

  // Quiet hours — solo canali rumorosi.
  if (noisy) {
    const h = now.getHours();
    const inQuiet =
      quiet.start > quiet.end
        ? h >= quiet.start || h < quiet.end
        : h >= quiet.start && h < quiet.end;
    if (inQuiet) return { allow: false, reason: "quiet_hours" };
  }

  // Cooldown per pattern.
  if (input.patternKey) {
    const key = `${userId}:${input.patternKey}`;
    const last = cooldownStore.get(key);
    if (last !== undefined && now.getTime() - last < cooldownMs) {
      return { allow: false, reason: "cooldown", retryAfter: last + cooldownMs };
    }
  }

  // Cap settimanale.
  const weekStart = startOfWeek(now).getTime();
  const wc = weeklyCounter.get(userId);
  if (wc && wc.weekStart === weekStart && wc.count >= maxPerWeek) {
    return { allow: false, reason: "weekly_cap" };
  }

  return { allow: true };
}

/**
 * Registra una consegna avvenuta: aggiorna cooldown del pattern e contatore
 * settimanale dell'utente. Da chiamare SOLO dopo l'invio effettivo.
 */
export function recordDelivery(input: GateCheckInput): void {
  const now = input.now ?? new Date();
  const userId = input.userId ?? DEFAULT_USER;

  if (input.patternKey) {
    cooldownStore.set(`${userId}:${input.patternKey}`, now.getTime());
  }

  const weekStart = startOfWeek(now).getTime();
  const wc = weeklyCounter.get(userId);
  if (wc && wc.weekStart === weekStart) {
    wc.count += 1;
  } else {
    weeklyCounter.set(userId, { weekStart, count: 1 });
  }
}

/** Azzera lo stato in-memory (cooldown + cap). Utile nei test/probe. */
export function resetGateState(): void {
  cooldownStore.clear();
  weeklyCounter.clear();
}

/** Lunedì 00:00 locale della settimana che contiene `d`. */
function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = (day + 6) % 7; // Lunedì = 0
  const m = new Date(d);
  m.setHours(0, 0, 0, 0);
  m.setDate(m.getDate() - diff);
  return m;
}

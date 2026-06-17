/**
 * Tick loop proattivo, generico — estratto da DietLogger-Agentic
 * (src/agent/proactive-tick.ts), spogliato del dominio dieta.
 *
 * Pattern "cheap-gate → cheap-write" (heartbeat economico):
 *  1. GATE deterministico (no LLM): l'agente fornisce `gate(userId)` → segnali.
 *     Il core filtra con `checkGate` (quiet-hours/cooldown/cap). Zero segnali
 *     ammessi → heartbeat silenzioso: niente LLM, niente invio.
 *  2. PRECOOK (no LLM, opzionale): `precook(userId)` arricchisce il contesto in
 *     diretta, così l'LLM scrittore non fa round-trip di tool.
 *  3. COMPOSE (LLM cheap): `composeOnce` formula UN messaggio breve.
 *  4. DELIVER via Channel; `recordDelivery` solo a invio riuscito.
 *
 * Claim atomico astratto: di default in-memory (un processo). L'agente può
 * passare un `DeliveryClaim` persistente (es. Prisma unique-constraint) per
 * deduplicare invii concorrenti durante gli overlap di deploy — è il pattern
 * `claimDelivery` dell'originale, qui iniettabile.
 */
import { DateTime } from "luxon";
import { checkGate, recordDelivery, type GateOptions } from "./gate.js";
import { composeOnce } from "./runtime/query.js";
import type { Channel } from "../channels/channel.js";

export interface TickSignal {
  /** Chiave di dedup (cooldown + claim). */
  patternKey: string;
  /** Severità libera (info|suggestion|warning|…), usata solo per il prompt. */
  severity?: string;
  /** Testo del segnale, passato al compositore. */
  message: string;
}

/**
 * Claim atomico di uno slot di consegna. `claim` ritorna true se QUESTO processo
 * deve inviare (ha vinto), false se già consegnato. `release` libera lo slot se
 * l'invio fallisce (così un tick successivo ritenta).
 */
export interface DeliveryClaim {
  claim(userId: string, patternKey: string, slotKey: string): Promise<boolean>;
  release(userId: string, patternKey: string, slotKey: string): Promise<void>;
}

/** Claim in-memory di default (singolo processo). */
export class InMemoryDeliveryClaim implements DeliveryClaim {
  private readonly seen = new Set<string>();
  private key(u: string, p: string, s: string) {
    return `${u}:${p}:${s}`;
  }
  async claim(userId: string, patternKey: string, slotKey: string): Promise<boolean> {
    const k = this.key(userId, patternKey, slotKey);
    if (this.seen.has(k)) return false;
    this.seen.add(k);
    return true;
  }
  async release(userId: string, patternKey: string, slotKey: string): Promise<void> {
    this.seen.delete(this.key(userId, patternKey, slotKey));
  }
}

export interface TickTarget {
  /** Id utente interno. */
  userId: string;
  /** Id di consegna sul canale (es. chat_id Telegram). Default = userId. */
  deliveryId?: string;
  /** Nome per i log. */
  name?: string;
}

export interface TickLoopConfig {
  /** Utenti da processare in questo tick. */
  targets: TickTarget[];
  /** Gate deterministico per utente → segnali grezzi (l'agente lo implementa). */
  gate(userId: string): Promise<TickSignal[]>;
  /** Compositore del messaggio. Default: composeOnce dell'SDK (LLM cheap). */
  compose(args: { target: TickTarget; signals: TickSignal[]; precooked?: string }): Promise<string>;
  /** Contesto pre-cotto opzionale (no LLM). */
  precook?(userId: string): Promise<string>;
  /** Canale di consegna. */
  channel: Channel;
  /** Claim atomico. Default: in-memory. */
  claim?: DeliveryClaim;
  /** Opzioni del gate anti-spam (cooldown/quiet/cap). */
  gateOptions?: GateOptions;
  /** Timezone per lo slot key. Default "Europe/Rome". */
  timezone?: string;
  /** Non invia: calcola solo gate + decisione. */
  dry?: boolean;
  /** Override orario per test. */
  date?: string;
  nowHour?: number;
}

export interface TickResult {
  userId: string;
  signalsFound: number;
  admitted: number;
  sent: boolean;
  message?: string;
}

/** Bucket temporale: giorno+ora locale, es. "2026-06-16T12". */
function slotKeyFor(timezone: string, date?: string, nowHour?: number): string {
  const base = date ? DateTime.fromISO(date, { zone: timezone }) : DateTime.now().setZone(timezone);
  const hour = nowHour ?? base.hour;
  return `${base.toISODate()}T${String(hour).padStart(2, "0")}`;
}

/** Esegue un tick proattivo su tutti i target. */
export async function runTickLoop(cfg: TickLoopConfig): Promise<TickResult[]> {
  const claim = cfg.claim ?? new InMemoryDeliveryClaim();
  const tz = cfg.timezone ?? "Europe/Rome";
  const slotKey = slotKeyFor(tz, cfg.date, cfg.nowHour);
  const noisy = cfg.channel.noisy;
  const results: TickResult[] = [];

  // `now` per il gate: in produzione undefined (ora reale). Per test con date/nowHour
  // simulati, costruiscilo da date+nowHour, altrimenti new Date(date) cadrebbe a
  // mezzanotte → quiet-hours bloccherebbe tutto erroneamente.
  let gateNow: Date | undefined;
  if (cfg.date) {
    const hh = String(cfg.nowHour ?? 12).padStart(2, "0");
    gateNow = new Date(`${cfg.date}T${hh}:00:00`);
  }

  for (const target of cfg.targets) {
    const signals = await cfg.gate(target.userId);

    const admitted = signals.filter((s) => {
      const d = checkGate({
        capability: "proactive_tick",
        patternKey: s.patternKey,
        userId: target.userId,
        noisy,
        ...cfg.gateOptions,
        now: gateNow,
      });
      return d.allow;
    });

    const label = target.name ?? target.userId;
    console.log(`[tick] ${label}: ${signals.length} segnali, ${admitted.length} ammessi.`);

    if (admitted.length === 0) {
      results.push({ userId: target.userId, signalsFound: signals.length, admitted: 0, sent: false });
      continue;
    }

    if (cfg.dry) {
      results.push({ userId: target.userId, signalsFound: signals.length, admitted: admitted.length, sent: false });
      continue;
    }

    // Claim atomico prima di comporre/inviare (anti-doppione concorrente).
    const claimed: TickSignal[] = [];
    for (const s of admitted) {
      if (await claim.claim(target.userId, s.patternKey, slotKey)) claimed.push(s);
    }
    if (claimed.length === 0) {
      results.push({ userId: target.userId, signalsFound: signals.length, admitted: admitted.length, sent: false });
      continue;
    }

    const precooked = cfg.precook ? await cfg.precook(target.userId).catch(() => "") : undefined;

    let message = "";
    try {
      message = await cfg.compose({ target, signals: claimed, precooked });
    } catch (err) {
      console.error(`[tick] compose fallito per ${label}:`, err instanceof Error ? err.message : err);
    }

    let sent = false;
    if (message) {
      try {
        await cfg.channel.send(target.deliveryId ?? target.userId, message);
        sent = true;
      } catch (err) {
        console.warn(`[tick] invio fallito per ${label}:`, err instanceof Error ? err.message : err);
      }
    }

    if (!sent) {
      // Rilascia i claim così un tick successivo ritenta.
      for (const s of claimed) await claim.release(target.userId, s.patternKey, slotKey).catch(() => {});
    } else {
      for (const s of claimed) {
        recordDelivery({
          capability: "proactive_tick",
          patternKey: s.patternKey,
          userId: target.userId,
          noisy,
          ...cfg.gateOptions,
        });
      }
    }

    results.push({
      userId: target.userId,
      signalsFound: signals.length,
      admitted: admitted.length,
      sent,
      message: message || undefined,
    });
  }

  return results;
}

/**
 * Compositore di default: LLM cheap one-shot dai segnali + contesto pre-cotto.
 * Un agente può passare il proprio `compose`; questo copre il caso comune.
 */
export function defaultCompose(opts: {
  persona: string;
  model?: string;
  defaultModel?: string;
  clientApp?: string;
  systemPromptFor?: (target: TickTarget) => string | Promise<string>;
}): TickLoopConfig["compose"] {
  return async ({ target, signals, precooked }) => {
    const signalSummary = signals.map((s) => `- [${s.severity ?? "info"}] ${s.message}`).join("\n");
    const systemPrompt = opts.systemPromptFor ? await opts.systemPromptFor(target) : opts.persona;
    const prompt =
      "Sei in modalità PROATTIVA: NON c'è un messaggio dell'utente, sei tu a iniziare. " +
      "Segnali rilevati (motore deterministico):\n\n" +
      signalSummary +
      (precooked ? `\n\nDati di contesto (NON inventare oltre questi):\n${precooked}` : "") +
      "\n\nScrivi UN solo messaggio breve (max 2 frasi), naturale e azionabile. " +
      "Non elencare i segnali: sintetizza il punto più utile. Non chiamare strumenti.";
    return composeOnce(prompt, {
      systemPrompt,
      model: opts.model,
      defaultModel: opts.defaultModel,
      clientApp: opts.clientApp,
    });
  };
}

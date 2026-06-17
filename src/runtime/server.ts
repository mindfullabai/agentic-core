/**
 * Runtime server always-on — estratto da DietLogger-Agentic (src/server.ts),
 * generalizzato. Avvia un Channel conversazionale + uno scheduler in-process.
 *
 * Pattern no-409 (validato in produzione): il tick gira nello STESSO processo
 * del canale in polling → un solo getUpdates Telegram, nessun conflitto 409. Un
 * tick in corso non si sovrappone a sé stesso (lock `running`). Avvio resiliente
 * con backoff sui 409 durante gli overlap di deploy.
 *
 * Il core non sa cosa fa il tick: l'agente passa `onTick`. node-cron è una
 * dependency del core; grammy resta nascosto dietro Channel.
 */
import cron, { type ScheduledTask } from "node-cron";
import type { Channel } from "../channels/channel.js";

export interface ScheduleOptions {
  /** Espressione cron. Default "0 8-22/2 * * *" (ogni 2h, 8→22). */
  cronExpr?: string;
  /** Timezone IANA. Default "Europe/Rome". */
  timezone?: string;
  /** Se "off", lo scheduler non parte. */
  disabled?: boolean;
}

/**
 * Registra uno scheduler in-process che esegue `onTick` secondo cron, con lock
 * anti-overlap. Ritorna la task cron (per stop manuale). Null se disabilitato/invalido.
 */
export function scheduleTick(onTick: () => Promise<void>, opts: ScheduleOptions = {}): ScheduledTask | null {
  if (opts.disabled) {
    console.log("[server] scheduler DISATTIVATO.");
    return null;
  }
  const cronExpr = opts.cronExpr ?? "0 8-22/2 * * *";
  const timezone = opts.timezone ?? "Europe/Rome";
  if (!cron.validate(cronExpr)) {
    console.error(`[server] cron non valido: "${cronExpr}" — scheduler non avviato.`);
    return null;
  }

  let running = false;
  const task = cron.schedule(
    cronExpr,
    async () => {
      if (running) {
        console.warn("[server] tick precedente ancora in corso — skip.");
        return;
      }
      running = true;
      const t0 = Date.now();
      try {
        await onTick();
        console.log(`[server] tick completato (${Date.now() - t0}ms).`);
      } catch (err) {
        console.error("[server] tick fallito:", err);
      } finally {
        running = false;
      }
    },
    { timezone },
  );
  console.log(`[server] scheduler attivo: "${cronExpr}" (${timezone}).`);
  return task;
}

export interface RunServerOptions {
  /** Canale conversazionale (es. TelegramChannel). Avviato in polling. */
  channel: Channel;
  /** Funzione tick proattiva (opzionale). */
  onTick?: () => Promise<void>;
  schedule?: ScheduleOptions;
  /** Hook di shutdown (chiudi DB, server HTTP, ecc.). */
  onShutdown?: () => Promise<void>;
}

/**
 * Avvia il runtime con retry resiliente sui 409. Lo scheduler è registrato PRIMA
 * dello start del canale (che può essere bloccante per il polling).
 */
export async function runServer(opts: RunServerOptions): Promise<void> {
  const startOnce = async (): Promise<void> => {
    if (opts.onTick) scheduleTick(opts.onTick, opts.schedule);

    const shutdown = async (sig: string) => {
      console.log(`\n[server] ${sig} — arresto...`);
      try {
        await opts.channel.stop?.();
        await opts.onShutdown?.();
      } finally {
        process.exit(0);
      }
    };
    process.once("SIGINT", () => void shutdown("SIGINT"));
    process.once("SIGTERM", () => void shutdown("SIGTERM"));

    await opts.channel.start?.();
  };

  // ritardo iniziale: lascia decadere una eventuale sessione getUpdates precedente.
  await new Promise((r) => setTimeout(r, 3000));
  for (let attempt = 1; ; attempt++) {
    try {
      await startOnce();
      return;
    } catch (err) {
      const is409 = err instanceof Error && /409|Conflict|terminated by other getUpdates/i.test(err.message);
      if (is409 && attempt <= 10) {
        const delay = Math.min(5000 * attempt, 30000);
        console.warn(`[server] 409 conflict (tentativo ${attempt}): ritento tra ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      console.error("[server] errore fatale:", err);
      process.exit(1);
    }
  }
}

/**
 * Helper CLI per eseguire un singolo tick — port da DietLogger-Agentic (tick.ts).
 *
 * Generico: l'agente costruisce la sua TickLoopConfig e la passa qui. Legge i
 * flag/env comuni (--dry, TICK_DATE, TICK_HOUR) e invoca runTickLoop una volta.
 * Comodo per test locali senza avviare lo scheduler.
 */
import { runTickLoop, type TickLoopConfig, type TickResult } from "./tick-loop.js";

/** Legge i flag standard del tick da argv/env e fa override sulla config. */
export function tickConfigFromCli(base: TickLoopConfig, argv = process.argv): TickLoopConfig {
  const dry = argv.includes("--dry");
  const date = process.env.TICK_DATE?.trim() || undefined;
  const nowHour = process.env.TICK_HOUR ? Number(process.env.TICK_HOUR) : undefined;
  return { ...base, dry: dry || base.dry, date: date ?? base.date, nowHour: nowHour ?? base.nowHour };
}

/** Esegue un singolo tick con i flag CLI applicati e logga un riepilogo. */
export async function runTickOnce(base: TickLoopConfig): Promise<TickResult[]> {
  const cfg = tickConfigFromCli(base);
  const results = await runTickLoop(cfg);
  const sent = results.filter((r) => r.sent).length;
  console.log(`[tick] done — ${sent}/${results.length} inviati (dry=${Boolean(cfg.dry)}).`);
  return results;
}

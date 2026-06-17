/**
 * Prompt builder parametrico — generalizzazione di DietLogger-Agentic
 * (src/agent/system-prompt.ts), che hardcodava la persona "Nina" e i tool dieta.
 *
 * Qui resta la STRUTTURA riusabile: iniezione del contesto temporale (luxon, così
 * l'agente non indovina "oggi" né il fuso) + persona + sezioni libere + blocco di
 * contesto persistente. L'agente passa la propria persona e le proprie sezioni;
 * il core non sa nulla del dominio.
 */
import { DateTime } from "luxon";

export interface PromptSection {
  /** Titolo della sezione (diventa `## titolo`). */
  title: string;
  /** Corpo della sezione (markdown libero). */
  body: string;
}

export interface PromptOptions {
  /** Persona / ruolo dell'agente (prima riga del prompt). */
  persona: string;
  /** Timezone IANA per il contesto temporale. Default "Europe/Rome". */
  timezone?: string;
  /** Istante "adesso" iniettabile per test. Default: ora. */
  now?: DateTime;
  /** Locale per il formato data umano. Default "it". */
  locale?: string;
  /** Sezioni tematiche del prompt (istruzioni, regole, tool-doc…). */
  sections?: PromptSection[];
  /** Blocco di contesto persistente (dal MemoryStore / dato dall'agente). */
  contextBlock?: string;
  /** Se false, omette il blocco "Contesto temporale". Default true. */
  includeTemporalContext?: boolean;
}

/**
 * Costruisce un system prompt parametrico. La sezione "Contesto temporale" è
 * iniettata automaticamente (data/ora locale ISO + umana) salvo opt-out.
 */
export function buildSystemPrompt(opts: PromptOptions): string {
  const tz = opts.timezone ?? "Europe/Rome";
  const now = (opts.now ?? DateTime.now()).setZone(tz);
  const locale = opts.locale ?? "it";

  const parts: string[] = [opts.persona.trim()];

  if (opts.includeTemporalContext !== false) {
    const nowHuman = now.setLocale(locale).toFormat("cccc d LLLL yyyy, HH:mm");
    const nowIso = now.toISO();
    parts.push(
      `## Contesto temporale\nAdesso è ${nowHuman} (timezone ${tz}, ISO ${nowIso}). ` +
        `Tutti i ragionamenti su orari e date sono in questo fuso.`,
    );
  }

  for (const s of opts.sections ?? []) {
    parts.push(`## ${s.title}\n${s.body.trim()}`);
  }

  if (opts.contextBlock?.trim()) {
    parts.push(`## Contesto (aggiornato a questo turno)\n${opts.contextBlock.trim()}`);
  }

  return parts.join("\n\n");
}

/**
 * Schema di configurazione di un agente — zod. Centralizza i parametri che un
 * agente always-on deve fornire e li valida al boot (fail-fast su config errata).
 *
 * È uno schema di RIFERIMENTO/utility: il core non lo impone, ma un agente può
 * usarlo per parsare le proprie env in modo tipizzato e coerente.
 */
import { z } from "zod";

export const AgentConfigSchema = z.object({
  /** Nome dell'agente (server MCP, log). */
  name: z.string().min(1),

  /** Modello di default (Anthropic id o modello dell'endpoint custom). */
  model: z.string().default("claude-sonnet-4-6"),
  /** Modello cheap per il tick. */
  tickModel: z.string().optional(),

  /** Cron del tick proattivo. */
  cron: z.string().default("0 8-22/2 * * *"),
  /** Timezone IANA. */
  timezone: z.string().default("Europe/Rome"),
  /** Disattiva lo scheduler. */
  tickDisabled: z.boolean().default(false),

  /** Backend memoria: file (default, zero-dep) o prisma. */
  store: z.enum(["file", "prisma"]).default("file"),
  /** Directory base del FileStore. */
  storeDir: z.string().default(".data/memory"),

  /** Canale di consegna. */
  channel: z.enum(["file", "push", "telegram"]).default("file"),
  /** Path del FileChannel (se channel=file). */
  channelFile: z.string().optional(),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

/** Parsa la config da un oggetto (es. env mappate). Lancia con errore leggibile. */
export function parseConfig(input: unknown): AgentConfig {
  return AgentConfigSchema.parse(input);
}

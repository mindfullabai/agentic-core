/**
 * Guard DB anti-produzione — port generalizzato da DietLogger-Agentic
 * (src/db/guard.ts). Ispeziona un DATABASE_URL e decide se è sicuro connettersi.
 *
 * Generalizzazione rispetto all'originale (che hardcodava "poc"):
 *  - allowlist host e pattern proibiti configurabili,
 *  - requisito sul nome DB configurabile (regex), opzionale,
 *  - eccezione Railway interna opt-in via env.
 *
 * Default SAFE: senza config, ammette solo host locali/docker. Un agente che
 * gira in produzione su un DB legittimo passa un `allowHosts` esplicito o
 * disabilita il guard (`enabled: false`) consapevolmente.
 */

const DEFAULT_ALLOWED_HOSTS = ["localhost", "127.0.0.1", "::1", "postgres", "db"];

const DEFAULT_FORBIDDEN_PATTERNS: RegExp[] = [
  /\.railway\.app$/i,
  /\.rlwy\.net$/i,
  /\.proxy\.rlwy\.net$/i,
  /\.amazonaws\.com$/i,
  /\.supabase\.co$/i,
  /\.neon\.tech$/i,
  /\.render\.com$/i,
];

export interface GuardResult {
  ok: boolean;
  host: string;
  database: string;
  reason?: string;
}

export interface DbGuardOptions {
  /** Se false, il guard è no-op (ok sempre). Default true. */
  enabled?: boolean;
  /** Host ammessi oltre ai default locali. */
  allowHosts?: string[];
  /** Pattern host vietati (sovrascrive i default se passato). */
  forbiddenPatterns?: RegExp[];
  /** Se presente, il nome DB deve combaciare (es. /test|poc/i). */
  requireDbNameMatch?: RegExp;
  /** Eccezione Railway interna: se true, ammette *.railway.internal. Default false. */
  allowRailwayInternal?: boolean;
}

/** Valuta un DATABASE_URL senza side-effect. */
export function evaluateDatabaseUrl(
  databaseUrl: string | undefined,
  opts: DbGuardOptions = {},
): GuardResult {
  if (opts.enabled === false) {
    return { ok: true, host: "", database: "" };
  }
  if (!databaseUrl) {
    return { ok: false, host: "", database: "", reason: "DATABASE_URL mancante" };
  }

  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return { ok: false, host: "", database: "", reason: "DATABASE_URL non parsabile" };
  }

  const host = url.hostname;
  const database = url.pathname.replace(/^\//, "");
  const forbidden = opts.forbiddenPatterns ?? DEFAULT_FORBIDDEN_PATTERNS;
  const allowed = new Set([...DEFAULT_ALLOWED_HOSTS, ...(opts.allowHosts ?? [])]);

  // Eccezione Railway interna (opt-in).
  if (opts.allowRailwayInternal && /\.railway\.internal$/i.test(host)) {
    if (opts.requireDbNameMatch && !opts.requireDbNameMatch.test(database)) {
      return {
        ok: false,
        host,
        database,
        reason: `DB "${database}" non combacia con ${opts.requireDbNameMatch} su host Railway interno.`,
      };
    }
    return { ok: true, host, database };
  }

  for (const pat of forbidden) {
    if (pat.test(host)) {
      return {
        ok: false,
        host,
        database,
        reason: `host "${host}" combacia con un pattern di PRODUZIONE (${pat}).`,
      };
    }
  }

  if (!allowed.has(host)) {
    return {
      ok: false,
      host,
      database,
      reason: `host "${host}" non è nella allowlist (${[...allowed].join(", ")}).`,
    };
  }

  if (opts.requireDbNameMatch && !opts.requireDbNameMatch.test(database)) {
    return {
      ok: false,
      host,
      database,
      reason: `il nome del database "${database}" non combacia con ${opts.requireDbNameMatch}.`,
    };
  }

  return { ok: true, host, database };
}

/** Aborta il processo se DATABASE_URL non è sicuro. Da chiamare al boot. */
export function assertSafeDatabase(
  databaseUrl = process.env.DATABASE_URL,
  opts: DbGuardOptions = {},
): GuardResult {
  const result = evaluateDatabaseUrl(databaseUrl, opts);
  if (!result.ok) {
    console.error(
      `\n🛑 [db-guard] CONNESSIONE BLOCCATA.\n   ${result.reason}\n   host="${result.host}" db="${result.database}"\n`,
    );
    process.exit(1);
  }
  return result;
}

/**
 * Capability Whoop — client REST diretto (OAuth2 refresh). NUOVA.
 *
 * Replica il flow di WhoopMcp/src/mcp-standalone.ts senza il file-token: il
 * refresh_token arriva da env/costruttore (headless, per Railway). L'access_token
 * è cachato in memoria finché valido (buffer 60s), refreshato al bisogno.
 *
 * ⚠️ Whoop PUÒ ruotare il refresh_token al refresh (vedi mcp-standalone riga 504:
 * `data.refresh_token || tokens.refresh_token`). Esponiamo `onRefreshTokenRotated`
 * così il chiamante può persistere il nuovo refresh (volume/secret) — altrimenti
 * un env statico scadrebbe. Vedi nota F3-6.
 *
 * Zero dipendenze (fetch).
 */

const AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
const API_BASE = "https://api.prod.whoop.com/developer/v2";

export interface WhoopRecord {
  cycle_id?: number;
  score?: { recovery_score?: number; hrv_rmssd_milli?: number; resting_heart_rate?: number };
}
export interface WhoopRecoveryResp {
  records?: WhoopRecord[];
}
export interface WhoopSleepResp {
  score?: {
    sleep_performance_percentage?: number;
    stage_summary?: { total_in_bed_time_milli?: number; total_awake_time_milli?: number };
  };
}

export interface WhoopClientOptions {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  /** Callback invocato se Whoop ritorna un nuovo refresh_token (rotazione). */
  onRefreshTokenRotated?: (newRefreshToken: string) => void | Promise<void>;
}

export class WhoopClient {
  private clientId: string;
  private clientSecret: string;
  private refreshToken: string;
  private accessToken: string | null = null;
  private expiresAt = 0; // epoch ms
  private onRotated?: (t: string) => void | Promise<void>;

  constructor(opts: WhoopClientOptions = {}) {
    this.clientId = opts.clientId ?? process.env.WHOOP_CLIENT_ID ?? "";
    this.clientSecret = opts.clientSecret ?? process.env.WHOOP_CLIENT_SECRET ?? "";
    this.refreshToken = opts.refreshToken ?? process.env.WHOOP_REFRESH_TOKEN ?? "";
    this.onRotated = opts.onRefreshTokenRotated;
  }

  private get configured(): boolean {
    return Boolean(this.clientId && this.clientSecret && this.refreshToken);
  }

  /** Garantisce un access_token valido (refresh se scaduto o assente). */
  private async ensureToken(): Promise<string> {
    if (!this.configured) {
      throw new Error("Whoop non configurato: servono WHOOP_CLIENT_ID/SECRET/REFRESH_TOKEN.");
    }
    if (this.accessToken && Date.now() < this.expiresAt - 60_000) {
      return this.accessToken;
    }
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.refreshToken,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      // alcuni provider richiedono lo scope al refresh; Whoop lo accetta opzionale
    });
    const res = await fetch(AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) throw new Error(`Whoop token refresh ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { access_token: string; expires_in: number; refresh_token?: string };
    this.accessToken = data.access_token;
    this.expiresAt = Date.now() + data.expires_in * 1000;
    // Rotazione refresh_token: se Whoop ne manda uno nuovo, aggiorna + notifica.
    if (data.refresh_token && data.refresh_token !== this.refreshToken) {
      this.refreshToken = data.refresh_token;
      await this.onRotated?.(data.refresh_token);
    }
    return this.accessToken;
  }

  private async get<T>(path: string): Promise<T> {
    const token = await this.ensureToken();
    const res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Whoop API ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as T;
  }

  /** Recovery per una data (YYYY-MM-DD). Ritorna il record più recente nel range. */
  async getRecovery(date: string): Promise<WhoopRecoveryResp> {
    const start = `${date}T00:00:00.000Z`;
    const end = `${date}T23:59:59.999Z`;
    return this.get<WhoopRecoveryResp>(`/recovery?start=${start}&end=${end}&limit=1`);
  }

  /** Sleep per cycle id (ottenuto da getRecovery → records[0].cycle_id). */
  async getSleepForCycle(cycleId: number): Promise<WhoopSleepResp> {
    return this.get<WhoopSleepResp>(`/cycle/${cycleId}/sleep`);
  }

  /** True se le credenziali ci sono (per decidere se la fonte è disponibile). */
  isConfigured(): boolean {
    return this.configured;
  }
}

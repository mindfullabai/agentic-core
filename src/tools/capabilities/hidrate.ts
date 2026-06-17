/**
 * Capability HidrateSpark — client REST diretto (Parse Server). NUOVA.
 *
 * Replica hidratespark-mcp (Python): login user/password → sessionToken, poi
 * query su /classes/Day. Session in-memory (re-login a ogni istanza: per un tick
 * 1/giorno è irrilevante). Zero dipendenze (fetch).
 */

const DEFAULT_SERVER = "https://www.hidrateapp.com/parse";

export interface HidrateDay {
  totalMl: number | null;
  goalMl: number | null;
}

export interface HidrateClientOptions {
  appId?: string;
  clientKey?: string;
  email?: string;
  password?: string;
  serverUrl?: string;
}

export class HidrateClient {
  private appId: string;
  private clientKey: string;
  private email: string;
  private password: string;
  private server: string;
  private sessionToken: string | null = null;

  constructor(opts: HidrateClientOptions = {}) {
    this.appId = opts.appId ?? process.env.HIDRATE_APP_ID ?? "";
    this.clientKey = opts.clientKey ?? process.env.HIDRATE_CLIENT_KEY ?? "";
    this.email = opts.email ?? process.env.HIDRATE_EMAIL ?? "";
    this.password = opts.password ?? process.env.HIDRATE_PASSWORD ?? "";
    this.server = opts.serverUrl ?? process.env.HIDRATE_SERVER_URL ?? DEFAULT_SERVER;
  }

  isConfigured(): boolean {
    return Boolean(this.appId && this.clientKey && this.email && this.password);
  }

  private parseHeaders(withSession = false): Record<string, string> {
    const h: Record<string, string> = {
      "X-Parse-Application-Id": this.appId,
      "X-Parse-REST-API-Key": this.clientKey,
      "X-Parse-Client-Key": this.clientKey,
    };
    if (withSession && this.sessionToken) h["X-Parse-Session-Token"] = this.sessionToken;
    return h;
  }

  private async login(): Promise<void> {
    if (!this.isConfigured()) throw new Error("Hidrate non configurato: servono HIDRATE_APP_ID/CLIENT_KEY/EMAIL/PASSWORD.");
    const url = `${this.server}/login?username=${encodeURIComponent(this.email)}&password=${encodeURIComponent(this.password)}`;
    const res = await fetch(url, { headers: this.parseHeaders() });
    if (!res.ok) throw new Error(`Hidrate login ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { sessionToken?: string };
    if (!data.sessionToken) throw new Error("Hidrate: login senza sessionToken.");
    this.sessionToken = data.sessionToken;
  }

  /** Riepilogo idratazione del giorno (YYYY-MM-DD). totalMl null se nessun log. */
  async getDailySummary(date: string): Promise<HidrateDay> {
    if (!this.sessionToken) await this.login();
    const where = encodeURIComponent(JSON.stringify({ date }));
    const res = await fetch(`${this.server}/classes/Day?where=${where}&limit=1`, {
      headers: this.parseHeaders(true),
    });
    if (!res.ok) throw new Error(`Hidrate Day ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as {
      results?: Array<{ totalAmount?: number; goal?: number; total_ml?: number; goal_ml?: number }>;
    };
    const row = data.results?.[0];
    if (!row) return { totalMl: null, goalMl: null };
    const totalMl = row.totalAmount ?? row.total_ml ?? null;
    const goalMl = row.goal ?? row.goal_ml ?? null;
    return {
      totalMl: totalMl && totalMl > 0 ? totalMl : null,
      goalMl: goalMl ?? null,
    };
  }
}

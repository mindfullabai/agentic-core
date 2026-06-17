/**
 * Capability Todoist — client REST diretto (Bearer token statico). NUOVA.
 *
 * Sostituisce la CLI homebrew (non portabile su Railway). Usa la Sync API v9 per
 * i task completati (storico affidabile) + REST v2 per i progetti. Zero deps.
 */

// API unificata v1 (la v9 sync e la rest v2 sono deprecate dal 2026).
const COMPLETED_URL = "https://api.todoist.com/api/v1/tasks/completed/by_completion_date";
const PROJECTS_URL = "https://api.todoist.com/api/v1/projects";

export interface TodoistCompletedItem {
  content: string;
  project_id: string;
  completed_at: string; // ISO
  // label info non sempre presente nello storico completed → fallback su item_object
  labels?: string[];
}
export interface TodoistProject {
  id: string;
  name: string;
}

export class TodoistClient {
  constructor(private token = process.env.TODOIST_API_TOKEN ?? "") {}

  isConfigured(): boolean {
    return Boolean(this.token);
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}` };
  }

  /**
   * Task completati in un giorno (YYYY-MM-DD). La Sync API completed/get_all
   * accetta `since`/`until` ISO. Ritorna items con content/project_id/completed_at;
   * le label arrivano da `items[].item_object.labels` quando presente.
   */
  async getCompleted(date: string, timezone?: string): Promise<TodoistCompletedItem[]> {
    if (!this.isConfigured()) throw new Error("Todoist non configurato: serve TODOIST_API_TOKEN.");
    // La API filtra in UTC. Per il giorno LOCALE (timezone), allarghiamo la
    // finestra a ±1 giorno e poi filtriamo i risultati per data locale: un task
    // chiuso la sera (es. 23:00 IT = 21:00Z) deve contare nel giorno giusto.
    const since = new Date(`${date}T00:00:00Z`);
    since.setUTCDate(since.getUTCDate() - 1);
    const until = new Date(`${date}T23:59:59Z`);
    until.setUTCDate(until.getUTCDate() + 1);
    const params = new URLSearchParams({
      since: since.toISOString().slice(0, 19) + "Z",
      until: until.toISOString().slice(0, 19) + "Z",
      limit: "200",
    });
    const res = await fetch(`${COMPLETED_URL}?${params}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Todoist completed ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as {
      items?: Array<{ content: string; project_id: string; completed_at: string; labels?: string[] }>;
    };
    const localDate = (iso: string): string => {
      if (!timezone) return iso.slice(0, 10); // fallback: data UTC
      // YYYY-MM-DD nel fuso richiesto
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(iso));
    };
    return (data.items ?? [])
      .filter((i) => localDate(i.completed_at) === date)
      .map((i) => ({
        content: i.content,
        project_id: i.project_id,
        completed_at: i.completed_at,
        labels: i.labels ?? [],
      }));
  }

  /** Lista progetti (id → name) via API v1. Paginata: ritorna `results`. */
  async getProjects(): Promise<TodoistProject[]> {
    if (!this.isConfigured()) throw new Error("Todoist non configurato: serve TODOIST_API_TOKEN.");
    const res = await fetch(`${PROJECTS_URL}?limit=200`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Todoist projects ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { results?: TodoistProject[] };
    return data.results ?? [];
  }
}

/**
 * Capability web-search — provider pluggable. NUOVA (non presente in DietLogger).
 *
 * Interfaccia `SearchProvider` + implementazione Brave (REST). Zero dipendenze.
 * Un agente può registrare un altro provider (SerpAPI, Tavily…) implementando
 * l'interfaccia. Richiede la API key del provider scelto.
 */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchProvider {
  readonly name: string;
  search(query: string, opts?: { count?: number; lang?: string }): Promise<SearchResult[]>;
}

/** Provider Brave Search (https://api.search.brave.com). Richiede BRAVE_API_KEY. */
export class BraveSearchProvider implements SearchProvider {
  readonly name = "brave";

  constructor(private readonly apiKey = process.env.BRAVE_API_KEY?.trim()) {}

  async search(query: string, opts: { count?: number; lang?: string } = {}): Promise<SearchResult[]> {
    if (!this.apiKey) throw new Error("BRAVE_API_KEY non configurata — web-search Brave non disponibile.");
    const params = new URLSearchParams({
      q: query,
      count: String(opts.count ?? 5),
    });
    if (opts.lang) params.set("search_lang", opts.lang);

    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: { Accept: "application/json", "X-Subscription-Token": this.apiKey },
    });
    if (!res.ok) throw new Error(`Brave Search ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as {
      web?: { results?: Array<{ title: string; url: string; description: string }> };
    };
    return (data.web?.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
    }));
  }
}

/** Esegue una ricerca con il provider dato (default Brave). */
export async function webSearch(
  query: string,
  opts: { count?: number; lang?: string; provider?: SearchProvider } = {},
): Promise<SearchResult[]> {
  const provider = opts.provider ?? new BraveSearchProvider();
  return provider.search(query, { count: opts.count, lang: opts.lang });
}

/**
 * FileStore — implementazione MemoryStore su file JSON. Zero dipendenze.
 *
 * Default per agenti semplici (es. scorecard serale): nessun DB richiesto, parte
 * senza Postgres. Un file per utente in `<baseDir>/<userId>.json`. Append in coda,
 * scrittura atomica (write tmp + rename) per evitare file corrotti su crash.
 *
 * Non pensato per alta concorrenza multi-processo; per quello → PrismaMemoryStore.
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import type {
  MemoryStore,
  MessageRole,
  StoredMessage,
  StoredSummary,
} from "../store.js";

interface UserFile {
  messages: StoredMessage[];
  summaries: StoredSummary[];
}

const EMPTY: UserFile = { messages: [], summaries: [] };

export interface FileStoreOptions {
  /** Directory base dove vivono i file utente. Default ".data/memory". */
  baseDir?: string;
  /** Tronca il testo del messaggio a N caratteri. Default 8000. */
  maxTextLength?: number;
}

export class FileStore implements MemoryStore {
  private readonly baseDir: string;
  private readonly maxTextLength: number;

  constructor(opts: FileStoreOptions = {}) {
    this.baseDir = opts.baseDir ?? join(".data", "memory");
    this.maxTextLength = opts.maxTextLength ?? 8000;
  }

  private fileFor(userId: string): string {
    // Sanifica userId per usarlo come nome file.
    const safe = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(this.baseDir, `${safe}.json`);
  }

  private async load(userId: string): Promise<UserFile> {
    try {
      const raw = await readFile(this.fileFor(userId), "utf8");
      const parsed = JSON.parse(raw) as {
        messages: Array<Omit<StoredMessage, "createdAt"> & { createdAt: string }>;
        summaries: Array<Omit<StoredSummary, "fromAt" | "toAt" | "createdAt"> & {
          fromAt: string;
          toAt: string;
          createdAt: string;
        }>;
      };
      return {
        messages: parsed.messages.map((m) => ({ ...m, createdAt: new Date(m.createdAt) })),
        summaries: parsed.summaries.map((s) => ({
          ...s,
          fromAt: new Date(s.fromAt),
          toAt: new Date(s.toAt),
          createdAt: new Date(s.createdAt),
        })),
      };
    } catch {
      return { ...EMPTY, messages: [], summaries: [] };
    }
  }

  private async save(userId: string, data: UserFile): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
    const path = this.fileFor(userId);
    const tmp = `${path}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
    await rename(tmp, path);
  }

  async appendMessage(
    userId: string,
    role: MessageRole,
    text: string,
    toolsUsed: string[] = [],
    channel = "file",
  ): Promise<void> {
    if (!text.trim()) return;
    try {
      const data = await this.load(userId);
      data.messages.push({
        role,
        text: text.slice(0, this.maxTextLength),
        toolsUsed,
        channel,
        createdAt: new Date(),
      });
      await this.save(userId, data);
    } catch (err) {
      console.warn("[memory:file] append fallito:", err instanceof Error ? err.message : err);
    }
  }

  async getLastSummary(userId: string): Promise<string | null> {
    const data = await this.load(userId);
    return data.summaries.at(-1)?.summary ?? null;
  }

  async getLastSummaryTo(userId: string): Promise<Date | null> {
    const data = await this.load(userId);
    return data.summaries.at(-1)?.toAt ?? null;
  }

  async getMessagesSince(userId: string, since?: Date): Promise<StoredMessage[]> {
    const data = await this.load(userId);
    if (!since) return data.messages;
    return data.messages.filter((m) => m.createdAt > since);
  }

  async createSummary(userId: string, summary: StoredSummary): Promise<void> {
    const data = await this.load(userId);
    data.summaries.push(summary);
    await this.save(userId, data);
  }
}

/**
 * PrismaMemoryStore — implementazione MemoryStore su Prisma.
 *
 * Port da DietLogger-Agentic (src/agent/conversation-memory.ts), de-accoppiato:
 * il core NON importa @prisma/client a runtime. Riceve via DI un client che
 * espone i due modelli necessari (structural typing): l'agente passa il suo
 * PrismaClient reale, che soddisfa l'interfaccia `PrismaLike`.
 *
 * Lo schema atteso (l'agente lo definisce nel suo prisma/schema.prisma):
 *   model ConversationMessage { id userId role text toolsUsed channel createdAt }
 *   model ConversationSummary { id userId summary fromAt toAt messageCount createdAt }
 */
import type {
  MemoryStore,
  MessageRole,
  StoredMessage,
  StoredSummary,
} from "../store.js";

/** Sottoinsieme di PrismaClient richiesto — soddisfatto dal client reale dell'agente. */
export interface PrismaLike {
  conversationMessage: {
    create(args: {
      data: {
        userId: string;
        role: string;
        text: string;
        toolsUsed: string[];
        channel: string;
      };
    }): Promise<unknown>;
    findMany(args: {
      where: { userId: string; createdAt?: { gt: Date } };
      orderBy: { createdAt: "asc" | "desc" };
    }): Promise<Array<{ role: string; text: string; toolsUsed: string[]; channel: string; createdAt: Date }>>;
  };
  conversationSummary: {
    create(args: {
      data: {
        userId: string;
        summary: string;
        fromAt: Date;
        toAt: Date;
        messageCount: number;
      };
    }): Promise<unknown>;
    findFirst(args: {
      where: { userId: string };
      orderBy: { createdAt: "desc" };
      select?: Record<string, boolean>;
    }): Promise<{ summary?: string; toAt?: Date } | null>;
  };
}

export interface PrismaMemoryStoreOptions {
  /** Tronca il testo del messaggio a N caratteri. Default 8000. */
  maxTextLength?: number;
}

export class PrismaMemoryStore implements MemoryStore {
  private readonly maxTextLength: number;

  constructor(private readonly db: PrismaLike, opts: PrismaMemoryStoreOptions = {}) {
    this.maxTextLength = opts.maxTextLength ?? 8000;
  }

  async appendMessage(
    userId: string,
    role: MessageRole,
    text: string,
    toolsUsed: string[] = [],
    channel = "telegram",
  ): Promise<void> {
    if (!text.trim()) return;
    try {
      await this.db.conversationMessage.create({
        data: { userId, role, text: text.slice(0, this.maxTextLength), toolsUsed, channel },
      });
    } catch (err) {
      console.warn("[memory:prisma] append fallito:", err instanceof Error ? err.message : err);
    }
  }

  async getLastSummary(userId: string): Promise<string | null> {
    const s = await this.db.conversationSummary.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { summary: true },
    });
    return s?.summary ?? null;
  }

  async getLastSummaryTo(userId: string): Promise<Date | null> {
    const s = await this.db.conversationSummary.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { toAt: true },
    });
    return s?.toAt ?? null;
  }

  async getMessagesSince(userId: string, since?: Date): Promise<StoredMessage[]> {
    const rows = await this.db.conversationMessage.findMany({
      where: { userId, ...(since ? { createdAt: { gt: since } } : {}) },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r) => ({
      role: r.role as MessageRole,
      text: r.text,
      toolsUsed: r.toolsUsed,
      channel: r.channel,
      createdAt: r.createdAt,
    }));
  }

  async createSummary(userId: string, summary: StoredSummary): Promise<void> {
    await this.db.conversationSummary.create({
      data: {
        userId,
        summary: summary.summary,
        fromAt: summary.fromAt,
        toAt: summary.toAt,
        messageCount: summary.messageCount,
      },
    });
  }
}

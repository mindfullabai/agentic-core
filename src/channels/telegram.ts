/**
 * TelegramChannel — canale conversazionale Telegram, generico.
 *
 * Estratto da DietLogger-Agentic (src/agent/channels/telegram.ts), spogliato di
 * ogni logica di dominio (tool nutrizione, persona Nina, vision pre-handoff): qui
 * resta SOLO il trasporto. La pipeline LLM/tool la fornisce il runtime via
 * `onMessage`. Audio/foto sono normalizzati a testo da hook opzionali.
 *
 * `grammy` è una peer dependency OPTIONAL: importata lazy, così un agente che non
 * usa Telegram non la richiede. Auto-claim ownership: il primo `/start` di un
 * utente sconosciuto viene passato a `onFirstContact`; se l'agente è single-owner
 * può catturare lì il proprio chat_id.
 */
import type { Channel, InboundHandler, InboundMessage } from "./channel.js";

const MAX_TG_MSG = 4096;

export interface TelegramChannelOptions {
  /** Token del bot. Se assente, risolto da TELEGRAM_BOT_TOKEN(_DEV). */
  token?: string;
  /**
   * Normalizza una nota vocale in testo (es. via capability STT). Se assente, i
   * messaggi vocali vengono ignorati con un avviso.
   */
  transcribeVoice?: (audio: Buffer) => Promise<string>;
  /**
   * Pre-analizza una foto e ritorna un testo da passare al runtime (es. via
   * capability vision). Se assente, le foto vengono ignorate con un avviso.
   */
  describePhoto?: (base64: Buffer, caption?: string) => Promise<string>;
  /** Renderizza il Markdown dell'LLM in MarkdownV2 Telegram. Default: testo grezzo. */
  renderMarkdown?: (text: string) => string;
}

/** Risolve il token: preferisce _DEV in locale per non rischiare il prod. */
export function resolveTelegramToken(explicit?: string): string {
  const token = (explicit || process.env.TELEGRAM_BOT_TOKEN_DEV || process.env.TELEGRAM_BOT_TOKEN)?.trim();
  if (!token) {
    throw new Error(
      "[telegram] Token mancante: passa `token` o imposta TELEGRAM_BOT_TOKEN_DEV / TELEGRAM_BOT_TOKEN.",
    );
  }
  return token;
}

function splitMessage(text: string): string[] {
  if (text.length <= MAX_TG_MSG) return [text];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += MAX_TG_MSG) chunks.push(text.slice(i, i + MAX_TG_MSG));
  return chunks;
}

export class TelegramChannel implements Channel {
  readonly name = "telegram";
  readonly noisy = true;

  private readonly token: string;
  // Tipato `any` per non dipendere dai tipi grammy a compile-time (peer optional).
  private bot: any;
  private handler?: InboundHandler;
  private firstContact?: (userId: string, meta?: Record<string, unknown>) => Promise<boolean>;

  constructor(private readonly opts: TelegramChannelOptions = {}) {
    this.token = resolveTelegramToken(opts.token);
  }

  /** Crea il Bot grammy (lazy import) e registra gli handler. */
  private async ensureBot(): Promise<void> {
    if (this.bot) return;
    let grammy: typeof import("grammy");
    try {
      grammy = await import("grammy");
    } catch {
      throw new Error(
        "[telegram] grammy non installato. Aggiungi `grammy` alle dependencies dell'agente.",
      );
    }
    const bot = new grammy.Bot(this.token);
    this.bot = bot;

    const renderMd = this.opts.renderMarkdown;
    const dispatch = async (userId: string, text: string, ctxObj: any, meta?: Record<string, unknown>) => {
      if (!this.handler) return;
      // Status effimero editabile + reply finale, legati a questo ctx Telegram.
      let statusMsg: any = null;
      let lastStatus = "";
      const setStatus = async (s: string) => {
        if (s === lastStatus) return;
        lastStatus = s;
        try {
          if (!statusMsg) statusMsg = await ctxObj.reply(s);
          else await ctxObj.api.editMessageText(statusMsg.chat.id, statusMsg.message_id, s).catch(() => {});
        } catch {
          /* best-effort */
        }
      };
      const reply = async (out: string) => {
        // Rimuovi lo status effimero, poi invia la risposta come messaggi NUOVI
        // (così genera la notifica push anche se l'app è in background — un edit no).
        if (statusMsg) await ctxObj.api.deleteMessage(statusMsg.chat.id, statusMsg.message_id).catch(() => {});
        statusMsg = null;
        // Chunking sul testo GREZZO (lunghezza reale), render per-chunk: evita di
        // troncare a metà di una sequenza di escape MarkdownV2.
        for (const rawChunk of splitMessage(out)) {
          const rendered = renderMd ? renderMd(rawChunk) : rawChunk;
          try {
            await ctxObj.api.sendMessage(userId, rendered, renderMd ? { parse_mode: "MarkdownV2" } : undefined);
          } catch {
            // Fallback: invia il chunk grezzo senza parse (meglio testo che errore).
            await ctxObj.api.sendMessage(userId, rawChunk).catch(() => {});
          }
        }
      };
      const msg: InboundMessage = { userId, text, meta, setStatus, reply };
      await this.handler(msg);
    };

    bot.command("start", async (ctx: any) => {
      const userId = String(ctx.from?.id ?? "");
      if (this.firstContact) {
        const ok = await this.firstContact(userId, { username: ctx.from?.username });
        if (!ok) {
          await ctx.reply("Accesso non autorizzato.");
          return;
        }
      }
      await ctx.reply("Pronto.");
    });

    bot.on("message:text", async (ctx: any) => {
      await dispatch(String(ctx.from.id), ctx.message.text, ctx, { chatId: ctx.chat.id });
    });

    if (this.opts.transcribeVoice) {
      bot.on(["message:voice", "message:audio"], async (ctx: any) => {
        try {
          const file = await ctx.getFile();
          const url = `https://api.telegram.org/file/bot${this.token}/${file.file_path}`;
          const res = await fetch(url);
          if (!res.ok) throw new Error(`download audio fallito: HTTP ${res.status}`);
          const audio = Buffer.from(await res.arrayBuffer());
          const text = await this.opts.transcribeVoice!(audio);
          await dispatch(String(ctx.from.id), text, ctx, { chatId: ctx.chat.id, kind: "voice" });
        } catch (err) {
          console.error("[telegram] errore audio:", err);
          await ctx.reply("Non sono riuscito a trascrivere l'audio.");
        }
      });
    }

    if (this.opts.describePhoto) {
      bot.on("message:photo", async (ctx: any) => {
        try {
          const file = await ctx.getFile();
          const url = `https://api.telegram.org/file/bot${this.token}/${file.file_path}`;
          const res = await fetch(url);
          if (!res.ok) throw new Error(`download foto fallito: HTTP ${res.status}`);
          const base64 = Buffer.from(await res.arrayBuffer());
          const text = await this.opts.describePhoto!(base64, ctx.message.caption?.trim());
          await dispatch(String(ctx.from.id), text, ctx, { chatId: ctx.chat.id, kind: "photo" });
        } catch (err) {
          console.error("[telegram] errore foto:", err);
          await ctx.reply("Non sono riuscito a elaborare la foto.");
        }
      });
    }
  }

  async send(userId: string, text: string): Promise<void> {
    await this.ensureBot();
    const renderMd = this.opts.renderMarkdown;
    // Chunk sul GREZZO (lunghezza reale), render per-chunk: l'escape di
    // telegramify espande il testo e farebbe spezzare un messaggio corto in 2.
    for (const rawChunk of splitMessage(text)) {
      const rendered = renderMd ? renderMd(rawChunk) : rawChunk;
      try {
        await this.bot.api.sendMessage(userId, rendered, renderMd ? { parse_mode: "MarkdownV2" } : undefined);
      } catch {
        await this.bot.api.sendMessage(userId, rawChunk).catch(() => {});
      }
    }
  }

  onMessage(handler: InboundHandler): void {
    this.handler = handler;
  }

  setFirstContact(fn: (userId: string, meta?: Record<string, unknown>) => Promise<boolean>): void {
    this.firstContact = fn;
  }

  async onFirstContact(userId: string, meta?: Record<string, unknown>): Promise<boolean> {
    return this.firstContact ? this.firstContact(userId, meta) : true;
  }

  async start(): Promise<void> {
    await this.ensureBot();
    // long polling. bot.start() di grammy è bloccante (risolve solo allo stop):
    // lo lanciamo staccato con onStart per confermare l'avvio e catturare errori.
    void this.bot
      .start({
        onStart: (info: { username?: string }) =>
          console.log(`[telegram] polling attivo @${info.username ?? "?"}`),
      })
      .catch((err: unknown) =>
        console.error("[telegram] polling fallito:", err instanceof Error ? err.message : err),
      );
  }

  async stop(): Promise<void> {
    if (this.bot) await this.bot.stop();
  }

  /** Accesso al bot grammy (dopo start/ensureBot) per applyIdentityToBot ecc. */
  async getBot(): Promise<{ api: any }> {
    await this.ensureBot();
    return this.bot;
  }
}

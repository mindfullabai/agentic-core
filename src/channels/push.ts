/**
 * PushChannel — canale solo-uscita via webhook HTTP (notifica push generica).
 *
 * Invia il messaggio come POST JSON a un endpoint configurato (es. ntfy, un
 * webhook proprio, un servizio push). Silenzioso per natura → noisy=false, non
 * soggetto a quiet hours. Zero dipendenze (fetch).
 */
import type { Channel, InboundHandler } from "./channel.js";

export interface PushChannelOptions {
  /** URL dell'endpoint che riceve la notifica. */
  endpoint: string;
  /** Header extra (es. Authorization). */
  headers?: Record<string, string>;
  /** Costruisce il body JSON dal messaggio. Default `{ userId, text }`. */
  buildBody?: (userId: string, text: string) => unknown;
}

export class PushChannel implements Channel {
  readonly name = "push";
  readonly noisy = false;

  constructor(private readonly opts: PushChannelOptions) {}

  async send(userId: string, text: string): Promise<void> {
    const body = this.opts.buildBody ? this.opts.buildBody(userId, text) : { userId, text };
    const res = await fetch(this.opts.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(this.opts.headers ?? {}) },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Push endpoint ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
  }

  onMessage(_handler: InboundHandler): void {
    /* no-op */
  }
}

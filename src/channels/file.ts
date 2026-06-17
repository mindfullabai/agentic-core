/**
 * FileChannel — canale solo-uscita su file (o stdout). Zero dipendenze.
 *
 * Default per agenti proattivi che scrivono un output durevole senza notifica
 * (es. scorecard serale pre-cotta → file che Mario rilegge). Utile anche negli
 * esempi e nei test: nessun token, nessuna rete.
 */
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Channel, InboundHandler } from "./channel.js";

export interface FileChannelOptions {
  /** File di output. Se assente, scrive su stdout. */
  path?: string;
  /** Prefissa ogni riga con un timestamp ISO. Default true. */
  timestamp?: boolean;
}

export class FileChannel implements Channel {
  readonly name = "file";
  readonly noisy = false;

  constructor(private readonly opts: FileChannelOptions = {}) {}

  async send(userId: string, text: string): Promise<void> {
    const stamp = this.opts.timestamp === false ? "" : `[${new Date().toISOString()}] `;
    const line = `${stamp}(${userId}) ${text}\n`;
    if (!this.opts.path) {
      process.stdout.write(line);
      return;
    }
    await mkdir(dirname(this.opts.path), { recursive: true });
    await appendFile(this.opts.path, line, "utf8");
  }

  // Canale solo-uscita: non riceve.
  onMessage(_handler: InboundHandler): void {
    /* no-op */
  }
}

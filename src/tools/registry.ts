/**
 * Tool registry generico — estratto da DietLogger-Agentic (src/tools/index.ts).
 *
 * Generalizza il pattern "factory → createSdkMcpServer" e deriva `allowedTools`
 * dalla STESSA lista di factory: un tool registrato è automaticamente raggiungibile
 * (l'originale aveva un bug dove tool registrati restavano fuori da allowedTools;
 * qui è impossibile per costruzione).
 *
 * Uso:
 *   const reg = new ToolRegistry("alita");
 *   reg.register(createScorecardTool, createFetchBiometricsTool);
 *   const server = reg.buildServer(ctx);
 *   query({ options: { mcpServers: { [reg.serverName]: server }, allowedTools: reg.allowedTools() } });
 */
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type { ToolContext } from "./context.js";

/** Forma minima di un tool SDK (ciò che `tool()` ritorna). */
export interface RegisteredTool {
  name: string;
  [key: string]: unknown;
}

/** Factory di un tool: riceve il ToolContext, ritorna un tool SDK. */
export type ToolFactory<Deps = Record<string, unknown>> = (ctx: ToolContext<Deps>) => RegisteredTool;

export class ToolRegistry<Deps = Record<string, unknown>> {
  private readonly factories: ToolFactory<Deps>[] = [];

  constructor(
    public readonly serverName: string,
    public readonly version = "0.1.0",
  ) {}

  /** Registra una o più factory di tool. */
  register(...factories: ToolFactory<Deps>[]): this {
    this.factories.push(...factories);
    return this;
  }

  /** Costruisce le istanze tool legate al contesto (utile per chiamarle a mano nel precook). */
  build(ctx: ToolContext<Deps>): RegisteredTool[] {
    return this.factories.map((f) => f(ctx));
  }

  /** Crea il server MCP in-process con tutti i tool registrati. */
  buildServer(ctx: ToolContext<Deps>) {
    return createSdkMcpServer({
      name: this.serverName,
      version: this.version,
      tools: this.build(ctx) as Parameters<typeof createSdkMcpServer>[0]["tools"],
    });
  }

  /** Nomi qualificati MCP (`mcp__<server>__<name>`) per l'opzione allowedTools. */
  allowedTools(ctx: ToolContext<Deps>): string[] {
    return this.build(ctx).map((t) => `mcp__${this.serverName}__${t.name}`);
  }
}

/** Re-export del costruttore `tool` SDK, così gli agenti non importano l'SDK direttamente. */
export { tool };

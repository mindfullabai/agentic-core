/**
 * Loop conversazionale generico — il cuore di un agente che chatta, ragiona,
 * chiama tool e mantiene il contesto. Port generalizzato da DietLogger-Agentic
 * (handleUserText + runTurn), disaccoppiato dal dominio.
 *
 * Compone i mattoni già nel core: AgentIdentity (persona), buildSystemPrompt,
 * ToolRegistry (tool MCP), MemoryStore (episodica), SessionManager (resume),
 * runAgent (SDK). Un turno = ricezione → contesto → query con tool → persist.
 */
import { buildSystemPrompt } from "./prompt-builder.js";
import { runAgent, type ToolEvent } from "./runtime/query.js";
import type { AgentIdentity } from "./identity.js";
import type { SessionManager } from "./session-manager.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolContext } from "../tools/context.js";
import type { MemoryStore } from "../memory/store.js";
import type { StatusChain } from "../channels/channel.js";

/** Ripulisce il nome MCP (`mcp__server__tool`) → `tool`. */
function cleanToolName(name: string): string {
  return name.replace(/^mcp__.*?__/, "");
}

export interface ConversationContext<Deps = Record<string, unknown>> {
  identity: AgentIdentity;
  registry: ToolRegistry<Deps>;
  sessions: SessionManager;
  store?: MemoryStore;
  /** Costruisce il ToolContext per questo utente (userId + deps specifiche). */
  toolContext: (userId: string) => ToolContext<Deps>;
  /** Blocco di contesto persistente da iniettare nel prompt (opzionale). */
  buildContextBlock?: (userId: string) => Promise<string> | string;
  /**
   * Traduce (nome-tool, args) in una label human-readable per la catena di stato
   * (es. `search_docs {query:"X"}` → `Cerco "X" nei documenti`). Se assente o se
   * ritorna falsy, si usa il nome del tool ripulito dal prefisso `mcp__<server>__`.
   */
  toolLabel?: (name: string, input: unknown) => string | undefined;
  model?: string;
  defaultModel?: string;
  clientApp?: string;
  timezone?: string;
  maxTurns?: number;
}

export interface TurnResult {
  text: string;
  toolsCalled: string[];
}

/**
 * Esegue un turno conversazionale per `userId` (conversationId = bucket sessione).
 * `status` (opzionale): catena di stato del canale (checklist). runTurn la pilota
 * da solo dagli eventi tool — l'agente non deve orchestrare nulla, basta passare
 * `msg.status`. Le label vengono da `ctx.toolLabel` (fallback: nome tool pulito).
 */
export async function runTurn<Deps = Record<string, unknown>>(
  ctx: ConversationContext<Deps>,
  userId: string,
  conversationId: string,
  input: string,
  status?: StatusChain,
): Promise<TurnResult> {
  // 1. Sessione: resume o nuova (idle-reset gestito dal SessionManager).
  const { resume } = ctx.sessions.beginTurn(conversationId);

  // 2. Persisti il messaggio utente (best-effort).
  if (ctx.store) void ctx.store.appendMessage(userId, "user", input).catch(() => {});

  // 3. Contesto + system prompt dall'identità.
  const contextBlock = ctx.buildContextBlock ? await ctx.buildContextBlock(userId) : undefined;
  const systemPrompt = buildSystemPrompt({
    persona: ctx.identity.persona,
    timezone: ctx.timezone,
    contextBlock,
  });

  // 4. Tool dell'agente + allowedTools, legati al contesto utente.
  const toolCtx = ctx.toolContext(userId);
  const server = ctx.registry.buildServer(toolCtx);
  const allowedTools = ctx.registry.allowedTools(toolCtx);

  // 4b. Pilota la catena di stato dagli eventi tool. Header "sto ragionando"
  // subito; ogni start → step in corso, ogni end → ✓/✗. La label viene da
  // ctx.toolLabel(name, input) con fallback al nome tool ripulito.
  let onToolEvent: ((e: ToolEvent) => void) | undefined;
  if (status) {
    void status.thinking();
    const labelFor = (name: string, inp: unknown): string =>
      (ctx.toolLabel?.(name, inp) || "").trim() || cleanToolName(name);
    onToolEvent = (e: ToolEvent) => {
      if (e.phase === "start") void status.step(e.id, labelFor(e.name, e.input));
      else void status.done(e.id, e.ok);
    };
  }

  // 5. Turno agentico (con resume sessione).
  const res = await runAgent(
    input,
    {
      systemPrompt,
      mcpServers: { [ctx.registry.serverName]: server },
      allowedTools,
      resume,
      model: ctx.model,
      defaultModel: ctx.defaultModel,
      clientApp: ctx.clientApp,
      maxTurns: ctx.maxTurns ?? 12,
    },
    onToolEvent,
  );

  // 6. Registra la sessione + persisti la risposta.
  ctx.sessions.endTurn(conversationId, res.sessionId);
  if (ctx.store && res.text) {
    void ctx.store.appendMessage(userId, "assistant", res.text, res.toolsCalled).catch(() => {});
  }

  return { text: res.text, toolsCalled: res.toolsCalled };
}

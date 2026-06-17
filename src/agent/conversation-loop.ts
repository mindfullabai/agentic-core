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
import { runAgent } from "./runtime/query.js";
import type { AgentIdentity } from "./identity.js";
import type { SessionManager } from "./session-manager.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolContext } from "../tools/context.js";
import type { MemoryStore } from "../memory/store.js";

export interface ConversationContext<Deps = Record<string, unknown>> {
  identity: AgentIdentity;
  registry: ToolRegistry<Deps>;
  sessions: SessionManager;
  store?: MemoryStore;
  /** Costruisce il ToolContext per questo utente (userId + deps specifiche). */
  toolContext: (userId: string) => ToolContext<Deps>;
  /** Blocco di contesto persistente da iniettare nel prompt (opzionale). */
  buildContextBlock?: (userId: string) => Promise<string> | string;
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
 * `onToolUse` per il feedback live del canale (status "sto usando X").
 */
export async function runTurn<Deps = Record<string, unknown>>(
  ctx: ConversationContext<Deps>,
  userId: string,
  conversationId: string,
  input: string,
  onToolUse?: (toolName: string) => void,
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
    onToolUse,
  );

  // 6. Registra la sessione + persisti la risposta.
  ctx.sessions.endTurn(conversationId, res.sessionId);
  if (ctx.store && res.text) {
    void ctx.store.appendMessage(userId, "assistant", res.text, res.toolsCalled).catch(() => {});
  }

  return { text: res.text, toolsCalled: res.toolsCalled };
}

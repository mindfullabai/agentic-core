/**
 * Wrapper sul Claude Agent SDK `query()` — model-agnostic.
 *
 * Centralizza la costruzione delle Options (incluso il cablaggio env per un
 * endpoint OpenAI-compatible come Qwen) e due helper di alto livello:
 *  - `runAgent`: turno agentico completo (con tool MCP), ritorna testo + tool usati.
 *  - `composeOnce`: scrittura cheap one-shot (no tool, no thinking) per il tick.
 *
 * Estrae il pattern ripetuto in DietLogger (proactive-tick, conversation-memory,
 * index/telegram costruivano le stesse Options a mano).
 */
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { getModelConfig, type ModelConfig } from "./env.js";

export interface BuildOptionsInput {
  /** Override modello (es. modello cheap per il tick). */
  model?: string;
  /** Modello di default se né override né env. */
  defaultModel?: string;
  systemPrompt?: string;
  /** MCP servers (tool). Chiave = nome server. */
  mcpServers?: Record<string, unknown>;
  allowedTools?: string[];
  maxTurns?: number;
  /** Disabilita il thinking (task di scrittura: thinking = solo costo/latenza). */
  disableThinking?: boolean;
  /** Sessione da riprendere (continuità multi-turn). */
  resume?: string;
  /** Tag client per il backend. */
  clientApp?: string;
}

/** Costruisce le Options SDK, cablando l'endpoint dal ModelConfig. */
export function buildOptions(input: BuildOptionsInput, cfg?: ModelConfig): Options {
  const model = cfg ?? getModelConfig(input.model, input.defaultModel);

  // env per il sottoprocesso SDK: se baseUrl/authToken sono definiti (endpoint
  // custom tipo Qwen), li passiamo; altrimenti l'SDK usa Anthropic nativo.
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  if (model.baseUrl && model.authToken) {
    env.ANTHROPIC_BASE_URL = model.baseUrl;
    env.ANTHROPIC_AUTH_TOKEN = model.authToken;
    env.ANTHROPIC_MODEL = model.model;
  }
  if (input.clientApp) env.CLAUDE_AGENT_SDK_CLIENT_APP = input.clientApp;

  const options: Options = {
    model: model.model,
    env,
    settingSources: [],
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    maxTurns: input.maxTurns ?? 12,
  };
  if (input.systemPrompt) options.systemPrompt = input.systemPrompt;
  if (input.mcpServers) options.mcpServers = input.mcpServers as Options["mcpServers"];
  if (input.allowedTools) options.allowedTools = input.allowedTools;
  if (input.disableThinking) options.thinking = { type: "disabled" };
  if (input.resume) options.resume = input.resume;
  return options;
}

export interface AgentTurnResult {
  text: string;
  toolsCalled: string[];
  sessionId?: string;
}

/**
 * Evento di ciclo di vita di un tool durante lo stream agentico. `start` quando
 * l'LLM invoca il tool (porta gli args, per derivarne una label); `end` quando il
 * risultato torna (porta l'esito ok/errore). `id` = tool_use_id dell'SDK, lega
 * lo `start` al suo `end` per una catena di stato (es. checklist su Telegram).
 */
export type ToolEvent =
  | { phase: "start"; id: string; name: string; input: unknown }
  | { phase: "end"; id: string; name: string; ok: boolean };

/**
 * Esegue un turno agentico completo. Streamma e accumula testo + tool usati.
 * `onToolEvent` (opzionale) riceve start/end di ogni tool durante lo stream —
 * per feedback live (catena di stato "sto usando X" → "✓ fatto") nei canali
 * conversazionali. Lo `start` arriva dai blocchi tool_use dei messaggi assistant;
 * l'`end` dai blocchi tool_result dei messaggi user successivi (stesso id).
 */
export async function runAgent(
  prompt: string,
  input: BuildOptionsInput,
  onToolEvent?: (event: ToolEvent) => void,
): Promise<AgentTurnResult> {
  const options = buildOptions(input);
  let text = "";
  const toolsCalled: string[] = [];
  let sessionId: string | undefined;
  // Mappa tool_use_id → nome, per dare un nome anche all'evento `end` (il
  // tool_result porta solo l'id, non il nome).
  const pending = new Map<string, string>();

  for await (const msg of query({ prompt, options })) {
    if (msg.type === "assistant") {
      for (const block of msg.message.content) {
        if (block.type === "tool_use") {
          toolsCalled.push(block.name);
          pending.set(block.id, block.name);
          onToolEvent?.({ phase: "start", id: block.id, name: block.name, input: block.input });
        } else if (block.type === "text" && block.text.trim()) {
          text += block.text;
        }
      }
    } else if (msg.type === "user") {
      // I tool_result arrivano come blocchi in un messaggio "user" sintetico.
      const content = msg.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block && typeof block === "object" && (block as { type?: string }).type === "tool_result") {
            const b = block as { tool_use_id: string; is_error?: boolean };
            // Emetti `end` SOLO per un tool_use visto in QUESTO turno: scarta i
            // tool_result di replay (resume sessione) che non hanno uno start qui.
            const name = pending.get(b.tool_use_id);
            if (name !== undefined) {
              pending.delete(b.tool_use_id);
              onToolEvent?.({ phase: "end", id: b.tool_use_id, name, ok: !b.is_error });
            }
          }
        }
      }
    } else if (msg.type === "result") {
      sessionId = msg.session_id;
    }
  }
  return { text: text.trim(), toolsCalled, sessionId };
}

/**
 * Scrittura cheap one-shot: nessun tool, nessun thinking, maxTurns 1.
 * Usata dal tick per comporre un messaggio breve da contesto pre-cotto.
 */
export async function composeOnce(
  prompt: string,
  input: Omit<BuildOptionsInput, "mcpServers" | "allowedTools" | "maxTurns" | "disableThinking">,
): Promise<string> {
  const options = buildOptions({ ...input, maxTurns: 1, disableThinking: true });
  let text = "";
  for await (const msg of query({ prompt, options })) {
    if (msg.type === "assistant") {
      for (const block of msg.message.content) {
        if (block.type === "text") text += block.text;
      }
    }
  }
  return text.trim();
}

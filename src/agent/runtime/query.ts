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
 * Esegue un turno agentico completo. Streamma e accumula testo + tool usati.
 * `onToolUse` (opzionale) viene invocato a ogni tool-use durante lo stream —
 * per feedback live ("sta usando X") nei canali conversazionali.
 */
export async function runAgent(
  prompt: string,
  input: BuildOptionsInput,
  onToolUse?: (toolName: string) => void,
): Promise<AgentTurnResult> {
  const options = buildOptions(input);
  let text = "";
  const toolsCalled: string[] = [];
  let sessionId: string | undefined;

  for await (const msg of query({ prompt, options })) {
    if (msg.type === "assistant") {
      for (const block of msg.message.content) {
        if (block.type === "tool_use") {
          toolsCalled.push(block.name);
          onToolUse?.(block.name);
        } else if (block.type === "text" && block.text.trim()) {
          text += block.text;
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

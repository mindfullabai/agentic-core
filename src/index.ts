/**
 * @agentic/core — public API.
 *
 * Boilerplate generico per agenti always-on, estratto da DietLogger-Agentic.
 * Re-export curato: ciò che un agente consuma per comporre il proprio runtime.
 *
 * Regola del monorepo: generico → qui (core); specifico dell'agente → nel suo
 * package. Vedi CLAUDE.md.
 */

export const version = "0.2.0";

// ── Runtime / modello ────────────────────────────────────────────────────────
export { loadEnv, getModelConfig, maskSecret, type ModelConfig } from "./agent/runtime/env.js";
export {
  buildOptions,
  runAgent,
  composeOnce,
  type BuildOptionsInput,
  type AgentTurnResult,
  type ToolEvent,
} from "./agent/runtime/query.js";
export {
  buildSystemPrompt,
  type PromptOptions,
  type PromptSection,
} from "./agent/prompt-builder.js";
export { type AgentIdentity, applyIdentityToBot, TELEGRAM_FORMAT_RULES } from "./agent/identity.js";
export { SessionManager, type SessionManagerOptions } from "./agent/session-manager.js";
export {
  runTurn,
  type ConversationContext,
  type TurnResult,
} from "./agent/conversation-loop.js";
export { summarizeSession, type SummarizeOptions } from "./memory/summarize.js";

// ── Gate anti-spam ───────────────────────────────────────────────────────────
export {
  checkGate,
  recordDelivery,
  resetGateState,
  type GateDecision,
  type GateReason,
  type GateCheckInput,
  type GateOptions,
  COOLDOWN_MS_DEFAULT,
  QUIET_HOURS_DEFAULT,
  MAX_PER_WEEK_DEFAULT,
} from "./agent/gate.js";

// ── Tick proattivo ───────────────────────────────────────────────────────────
export {
  runTickLoop,
  defaultCompose,
  InMemoryDeliveryClaim,
  type TickSignal,
  type TickTarget,
  type TickLoopConfig,
  type TickResult,
  type DeliveryClaim,
} from "./agent/tick-loop.js";
export { runTickOnce, tickConfigFromCli } from "./agent/tick.js";

// ── Server always-on ─────────────────────────────────────────────────────────
export {
  runServer,
  scheduleTick,
  type RunServerOptions,
  type ScheduleOptions,
} from "./runtime/server.js";

// ── Memoria ──────────────────────────────────────────────────────────────────
export {
  type MemoryStore,
  type MessageRole,
  type StoredMessage,
  type StoredSummary,
} from "./memory/store.js";
export { FileStore, type FileStoreOptions } from "./memory/file/store.js";
export { PrismaMemoryStore, type PrismaLike } from "./memory/prisma/store.js";
export {
  evaluateDatabaseUrl,
  assertSafeDatabase,
  type DbGuardOptions,
  type GuardResult,
} from "./memory/prisma/guard.js";

// ── Canali ───────────────────────────────────────────────────────────────────
export { type Channel, type InboundMessage, type InboundHandler, type StatusChain } from "./channels/channel.js";
export { FileChannel, type FileChannelOptions } from "./channels/file.js";
export { PushChannel, type PushChannelOptions } from "./channels/push.js";
export {
  TelegramChannel,
  resolveTelegramToken,
  type TelegramChannelOptions,
} from "./channels/telegram.js";

// ── Tool ─────────────────────────────────────────────────────────────────────
export {
  ToolRegistry,
  tool,
  type ToolFactory,
  type RegisteredTool,
} from "./tools/registry.js";
export {
  type ToolContext,
  type SdkToolResult,
  jsonResult,
  jsonError,
} from "./tools/context.js";

// ── Capability ───────────────────────────────────────────────────────────────
export { analyzeImage, parseJsonFromText, type VisionBackend } from "./tools/capabilities/vision.js";
export { transcribeAudio, type TranscribeOptions } from "./tools/capabilities/stt.js";
export {
  webSearch,
  BraveSearchProvider,
  type SearchProvider,
  type SearchResult,
} from "./tools/capabilities/web-search.js";
export { synthesizeSpeech, type TtsOptions } from "./tools/capabilities/tts.js";
export {
  WhoopClient,
  type WhoopClientOptions,
  type WhoopRecoveryResp,
  type WhoopSleepResp,
} from "./tools/capabilities/whoop.js";
export { HidrateClient, type HidrateClientOptions, type HidrateDay } from "./tools/capabilities/hidrate.js";
export {
  TodoistClient,
  type TodoistCompletedItem,
  type TodoistProject,
} from "./tools/capabilities/todoist.js";

// ── Config ───────────────────────────────────────────────────────────────────
export { AgentConfigSchema, parseConfig, type AgentConfig } from "./config.js";

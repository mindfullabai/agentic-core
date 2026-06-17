# @agentic/core

Boilerplate generico per **agenti always-on**, estratto da DietLogger-Agentic (pattern validato in produzione su Railway).

Fornisce i mattoni riusabili — runtime model-agnostic, scheduler proattivo, gate anti-spam, memoria pluggable, canali astratti, tool-registry, capability — lasciando all'agente solo la logica di dominio.

## Cosa c'è dentro

| Modulo | Cosa fa |
|---|---|
| `runtime/env` + `runtime/query` | Wrapper Claude Agent SDK, model-agnostic (Anthropic di default, endpoint OpenAI-compatible come Qwen via env). |
| `agent/gate` | Gate anti-spam deterministico (cooldown, quiet-hours, cap settimanale). Zero LLM. |
| `agent/prompt-builder` | System prompt parametrico (persona + sezioni + contesto temporale + memoria). |
| `agent/tick-loop` + `agent/tick` | Loop proattivo cheap-gate→precook→compose→deliver, con claim atomico. |
| `runtime/server` | Scheduler in-process **no-409** + avvio resiliente con backoff. |
| `memory/*` | `MemoryStore` pluggable: `FileStore` (default, zero-dep) o `PrismaMemoryStore` (DI). Guard DB anti-prod. |
| `channels/*` | `Channel` astratto: `FileChannel`, `PushChannel`, `TelegramChannel` (grammy peer optional). |
| `tools/registry` | Registry tipizzato → server MCP SDK; `allowedTools` derivati automaticamente. |
| `tools/capabilities/*` | `vision` (OCR Gemini/OpenAI), `stt` (Whisper), `web-search` (Brave pluggable), `tts` (ElevenLabs). |

## Quick start

```ts
import { runTickLoop, FileChannel, defaultCompose } from "@agentic/core";

const results = await runTickLoop({
  targets: [{ userId: "mario", name: "Mario" }],
  gate: async () => [{ patternKey: "scorecard", message: "Scorecard non compilata." }],
  compose: defaultCompose({ persona: "Sei l'assistente di Mario." }),
  channel: new FileChannel({ path: ".data/out.log" }),
});
```

Esempio completo eseguibile senza API key: `agentic-boilerplate/examples/minimal-agent`.

## Backend model-agnostic

- **Anthropic** (default): imposta `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` opzionale.
- **Qwen / endpoint OpenAI-compatible**: imposta `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_MODEL`.

Vedi `CLAUDE.md` per come estendere (tool, channel, capability) e la regola core-vs-agente.

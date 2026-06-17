# CLAUDE.md — @agentic/core

Doc agent-oriented per chi estende il core (Kai e i suoi cloni).

## Regola d'oro: generico → core, specifico → agente

Prima di aggiungere codice qui, chiediti: **lo riuserebbe un agente qualsiasi?**
- Sì (SDK wrapper, scheduler, gate, canali, registry, capability) → `@agentic/core`.
- No (tool di dominio, persona, cron specifico, schema DB) → nel package dell'agente.

Il core NON deve mai importare codice di un agente. Se una fix nasce in un agente
ed è generica, **spostala** nel core (non copiarla): col monorepo `workspace:*`
l'agente la rivede istantaneamente.

## Aggiungere un tool

1. Scrivi una factory `(ctx: ToolContext) => RegisteredTool` usando `tool()`.
2. Registrala: `registry.register(createMioTool)`.
3. Gli `allowedTools` si derivano da soli (`registry.allowedTools(ctx)`).

Input: shape zod (NON `z.object(...)`, l'SDK avvolge). Output: sempre `jsonResult()`;
errori di dominio con `jsonError()` (niente `throw` → l'LLM si corregge).

## Aggiungere un canale

Implementa `Channel` (`channels/channel.ts`): minimo `send`; per i conversazionali
anche `onMessage`/`start`/`stop` e, se single-owner, `onFirstContact` (auto-claim).
Dipendenze pesanti (es. grammy) come **peer optional** + import lazy.

## Aggiungere una capability

In `tools/capabilities/`. Regole: `fetch` REST puro (zero dep npm dove possibile),
API key da env, errore chiaro se la key manca (tool opzionale, non blocca il boot).

## Storage

`MemoryStore` astrae la persistenza. Default `FileStore` (zero-dep). Per Prisma usa
`PrismaMemoryStore` passando il client via DI (il core NON importa `@prisma/client`
a runtime: structural typing). Schema atteso documentato in `memory/prisma/store.ts`.

## Pattern critici (NON reinventare)

- **No-409**: tick e canale nello stesso processo (`runtime/server.ts`). Un solo
  getUpdates. Lock `running` anti-overlap + retry backoff sui 409.
- **Claim atomico**: `DeliveryClaim` deduplica invii concorrenti. In-memory di
  default; passa un claim persistente (Prisma unique-constraint) in produzione
  multi-istanza.
- **Cheap-gate → cheap-write**: il gate costa ~zero, il cron si sveglia spesso; il
  modello cheap scrive solo quando c'è qualcosa. Vedi `tick-loop.ts`.

---
topics: [decision, feishu, reuse]
doc_kind: decision
created: 2026-05-31
---

# D002: Reuse clowder-local's FeishuAdapter instead of building from scratch

## Context

We needed a complete Feishu interaction layer to handle:
- Inbound message parsing (text, post/rich-text, image, file, audio)
- Outbound message sending (text, interactive cards, streaming cards, media upload)
- Token management (tenant_access_token with auto-refresh)
- Card formatting for rich message delivery

Two paths were available:

1. **Build from scratch**: Write our own `api-client.ts`, `card-builder.ts`, etc.
2. **Reuse clowder-local's FeishuAdapter**: Copy + adapt the battle-tested adapter code.

## Options Considered

| Option | Pros | Cons |
|--------|------|------|
| A: Build from scratch | Full control, no external dependency, minimal code | Would take weeks to match clowder-local's feature set; would need to learn and handle all Feishu API edge cases; risk of bugs in message parsing / media handling / streaming |
| B: Copy FeishuAdapter as-is | All features available immediately; 841 lines of production-tested code; no external coupling (just `@larksuiteoapi/node-sdk`) | 841 lines to maintain; need to understand the codebase; risk of clowder-local evolving and our fork diverging |
| C: Import clowder-local as dependency | Automatic updates; single source of truth | Clowder-local is a monorepo with dozens of internal dependencies (`@cat-cafe/shared`, `fastify`, Socket.IO, etc.); would pull in entire platform |

## Decision

**Chosen: Option B — Copy + adapt FeishuAdapter and related files from clowder-local.**

Files copied as-is:
- `FeishuAdapter.ts` (841 lines) — Core adapter with full feature parity
- `FeishuTokenManager.ts` (47 lines) — Token caching, zero external deps
- `feishu-card-formatter.ts` (71 lines) — RichBlock → Lark card JSON
- `feishu-receipt-lines.ts` (94 lines) — Cat-personality receipt texts

Files adapted (simplified for single-user bridge):
- `StreamingOutboundHook.ts` — Multi-thread → single-chat binding

Adaptation work:
- `@cat-cafe/shared` types (RichBlock, MessageEnvelope) → inlined into `types.ts`
- `FastifyBaseLogger` → replaced with simple `Logger` interface
- `IStreamableOutboundAdapter` → defined locally in FeishuAdapter.ts
- `ConnectorRouter` → replaced with our own `message-handler.ts` + `index.ts` wiring

## Consequences

- **Positive**: FeishuAdapter provides all Feishu interaction features from day one — message parsing (text/post/image/file/audio with locale resolution), streaming cards (placeholder→PATCH→finalize), media upload (with ffmpeg opus conversion), SSRF-safe downloading, emoji reactions, bot @mention filtering, and rich card formatting.
- **Positive**: Reduced development time from weeks to hours. The adapter code is production-tested in clowder-local with real Feishu deployment.
- **Negative**: 841 lines of external code to maintain. If clowder-local makes significant FeishuAdapter changes, we need to manually sync.
- **Negative**: The adapter still depends on `@larksuiteoapi/node-sdk` (not just for WS, but also for REST via `lark.Client.im.message.*`). This is the same SDK clowder-local uses.

## References

- [`tech-architecture.md`](../specs/tech-architecture.md) — Module layout and reuse strategy
- clowder-local `FeishuAdapter.ts` — Original source
- clowder-local `StreamingOutboundHook.ts` — Original streaming management

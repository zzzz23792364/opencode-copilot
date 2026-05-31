---
topics: [decision, architecture]
doc_kind: decision
created: 2026-05-31
---

# D001: Use `opencode run --session` CLI instead of `opencode serve` REST API

## Context

opencode provides two ways to interact with sessions programmatically:

1. **`opencode serve` + `opencode attach`**: REST API server with SSE events. Used by `opencode-im-bridge` (v0.46.0).
2. **`opencode run --session <id> --format json <prompt>`**: CLI that writes directly to the shared SQLite DB.

The old `opencode-im-bridge` used mode 1, which had reliability issues: session management was split between TUI and bridge, and the serve process could crash or lose track of sessions.

## Options Considered

| Option | Pros | Cons |
|--------|------|------|
| A: `opencode serve` + SDK | Official API, SDK wrappers, SSE streaming | Session management splits across processes; serve process must stay alive; unreliable per upstream experience |
| B: `opencode run --session` CLI | Writes directly to shared SQLite DB; no serve process to maintain; same DB as TUI reads; simpler architecture | ~200-500ms cold-start per invocation; no real-time SSE (NDJSON is line-delimited stdout) |
| C: Open SDK directly (`@opencode-ai/sdk`) | Type-safe, no subprocess | Requires serve process; same reliability issues as Option A; adds SDK dependency |

## Decision

**Chosen: Option B — `opencode run --session --format json` via child process spawn.**

This was validated before any code was written: `opencode run --session ses_xxx --format json "你好"` produces NDJSON events that can be parsed line-by-line, and the messages appear in the TUI because they share the same `~/.local/share/opencode/opencode.db`.

## Consequences

- **Positive**: No additional server process to manage. Bridge talks directly to the same DB as TUI, guaranteeing session consistency.
- **Positive**: Simpler architecture — one `spawn()` call replaces an entire REST client + SSE subscription layer.
- **Negative**: Each invocation spawns a new subprocess (~400ms overhead). Acceptable for chatbot use case.
- **Negative**: No built-in streaming support — must parse NDJSON line by line from stdout.
- **Negative**: The CLI interface is not officially documented as a stable API; may change between opencode versions.

## References

- [`tech-architecture.md`](../specs/tech-architecture.md) — Full technical specification
- clowder-local's `OpenCodeAgentService.ts` — Uses the same `opencode run --session --format json` pattern

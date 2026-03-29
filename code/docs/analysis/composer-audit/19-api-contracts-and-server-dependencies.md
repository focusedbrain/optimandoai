# API contracts and server dependencies

## Purpose
IPC, HTTP, and service boundaries touched by composers and AI context.

## Files
- `apps/electron-vite-project/electron/preload.ts` — `emailAccounts`, `emailInbox`, `handshakeView.chatWithContextRag`
- `apps/electron-vite-project/electron/main.ts` — HTTP `httpApp` routes including `/api/parser/pdf/extract`, orchestrator hooks
- `apps/electron-vite-project/src/shims/handshakeRpc.ts`
- `BeapInlineComposer` — `ORCHESTRATOR_HTTP_BASE` fetch sessions

## Ownership
Main process owns HTTP server; renderer calls via `window.*` bridges.

## Rendering path
N/A.

## Inputs and outputs
| Surface | API | Transport |
|---------|-----|-------------|
| Email send | `emailAccounts.sendEmail` | IPC |
| Inbox files | `emailInbox.readFileForAttachment` | IPC |
| Handshake list | `listHandshakes` shim → likely IPC/RPC | Async |
| PDF text (context) | POST `/api/parser/pdf/extract` | HTTP localhost |
| AI chat | `handshakeView.chatWithContextRag` | IPC invoke |
| Orchestrator sessions | GET/POST `127.0.0.1:51248/api/orchestrator/...` | HTTP |

## Dependencies
Electron version pinned in root `package.json` overrides; express in main for HTTP.

## Data flow
Renderer never talks to Ollama directly — always via main/handshake layer.

## UX impact
Port **51248** must match running orchestrator — mismatch → PDF extract fails silently (warn in console).

## Current issues
Hardcoded HTTP bases scattered (composer vs HybridSearch port constant).

## Old vs new comparison
Same IPC family as legacy dashboard.

## Reuse potential
Config module for ports and feature flags.

## Change risk
IPC signature changes require preload + main sync.

## Notes
**Uncertainty:** Full list of `httpApp` listen ports — search `listen(` in `main.ts` for authoritative port map.

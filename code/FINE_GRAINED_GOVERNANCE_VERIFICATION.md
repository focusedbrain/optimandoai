# Fine-Grained Governance — Verification Summary

## 1. What Now Works Per Item

### Cloud AI
- `handshake.requestContextBlocks` and `handshake:queryContextBlocks` accept optional `purpose: 'cloud_ai'`
- When purpose is `cloud_ai`, blocks are filtered by `filterBlocksForCloudAI()` — only blocks with `cloud_ai_allowed === true` are returned
- Handshake-level `allowsCloudEscalation` remains the upper bound; item-level refines further
- HTTP route `GET /api/handshake/:id/context-blocks?purpose=cloud_ai` returns filtered blocks

### Export
- `handshake.requestContextBlocks` with `purpose: 'export'` returns only blocks with `export_allowed === true`
- HTTP route `GET /api/handshake/:id/context-blocks?purpose=export` returns filtered blocks
- Callers of export-context tool must use purpose `export` when fetching blocks

### Search / Embedding
- `getPendingEmbeddingBlocks` returns blocks with governance; `processEmbeddingQueue` filters by `searchable` before embedding
- Non-searchable blocks are marked `embedding_status = 'complete'` without inserting into `context_embeddings` (skipped)
- `semanticSearch` filters results by `searchable` — only blocks with `searchable === true` are returned
- Legacy blocks (no governance_json) use inferred governance; searchable defaults to allow for backward compat

### Context Sync
- `tryEnqueueContextSync` filters `pending_delivery` blocks by `transmit_to_peer_allowed`
- Only blocks with `transmit_to_peer_allowed === true` are included in the context_sync capsule
- Denied blocks remain in `pending_delivery` and are excluded from outbound sync

### Auto-reply / Automation Guard
- `filterBlocksForAutoReply()` in `contextGovernance.ts` — reusable helper for future auto-reply or workflow logic
- `handshake.requestContextBlocks` with `purpose: 'auto_reply'` returns only blocks with `auto_reply_allowed === true`
- Future automation entry points should call `queryContextBlocks(handshakeId, 'auto_reply')` or use `filterBlocksForAutoReply(blocks, baseline)` on pre-fetched blocks

### Local AI Regression Check
- Local AI filtering continues to work: `HandshakeChatSidebar` passes `purpose: 'local_ai'` when fetching blocks
- Server-side filtering via `filterBlocksForLocalAI()` when purpose is `local_ai`
- Client-side `filterBlocksForLocalAI()` in `contextEscaping.ts` remains as defense-in-depth

---

## 2. What Still Remains Handshake-Level Only

- **Scope checks**: `authorizeAction` and `authorizeToolInvocation` use handshake `allowedScopes` for scope matching
- **Tool authorization gate**: `authorizeToolInvocation` still checks handshake-level `allowsCloudEscalation` and `allowsExport` before tool execution — item-level filtering happens at data fetch, not at the gate
- **Attestation**: Enterprise tier attestation requirements are handshake-level

---

## 3. Files Changed

| File | Purpose |
|------|---------|
| `apps/electron-vite-project/electron/main/handshake/contextGovernance.ts` | Added `filterBlocksForLocalAI`, `filterBlocksForCloudAI`, `filterBlocksForExport`, `filterBlocksForSearch`, `filterBlocksForPeerTransmission`, `filterBlocksForAutoReply` |
| `apps/electron-vite-project/electron/main/handshake/contextBlocks.ts` | Extended `getPendingEmbeddingBlocks` to return `handshake_id`, `governance_json`, `type`, etc. for policy-aware filtering |
| `apps/electron-vite-project/electron/main/handshake/embeddings.ts` | `processEmbeddingQueue` filters by `searchable` before embedding; `semanticSearch` filters results by `searchable` |
| `apps/electron-vite-project/electron/main/handshake/contextSyncEnqueue.ts` | Filter `pending_delivery` by `transmit_to_peer_allowed` before building context_sync capsule |
| `apps/electron-vite-project/electron/main/handshake/ipc.ts` | `handshake.requestContextBlocks` accepts `purpose`; filters blocks by purpose; HTTP route `/api/handshake/:id/context-blocks` supports `?purpose=` |
| `apps/electron-vite-project/electron/main.ts` | `handshake:queryContextBlocks` IPC accepts optional `purpose` |

| `apps/electron-vite-project/electron/preload.ts` | `queryContextBlocks` accepts optional `purpose` |
| `apps/electron-vite-project/src/components/handshakeViewTypes.ts` | `queryContextBlocks` type updated with optional `purpose` |
| `apps/electron-vite-project/src/components/HandshakeChatSidebar.tsx` | Pass `purpose: 'local_ai'` when fetching blocks for chat |

---

## 4. Known Limitations

1. **Cloud AI / Export tool handlers**: No production handlers for `cloud-escalation` or `export-context` are registered; when these tools are implemented, callers must fetch blocks with `purpose: 'cloud_ai'` or `purpose: 'export'` and pass them in parameters
2. **Semantic search callers**: Any code that invokes `semanticSearch` receives filtered results; no additional changes needed unless a new search path exists that bypasses `semanticSearch`
3. **Auto-reply pipeline**: No auto-reply logic exists yet; `filterBlocksForAutoReply` is ready for future use

---

## 5. Safety / Compatibility Notes

### Legacy Records
- **inferGovernanceFromLegacy()** continues to apply when `governance_json` is missing
- **Searchable**: Legacy blocks default to allow (backward compat) for search
- **Cloud AI, Export, Peer Transmission**: Legacy blocks use baseline; inferred defaults are conservative (e.g. message items use `MESSAGE_DEFAULT_POLICY` with `cloud_ai_allowed: false`)

### Stricter Behavior by Design
- **Cloud AI**: Missing/inferred governance → deny (conservative)
- **Export**: Missing/inferred governance → deny (conservative)
- **Auto-reply**: Missing/inferred governance → deny (conservative)
- **Embedding**: Non-searchable blocks are marked complete without embedding; they never appear in semantic search

### Explicit Deny Wins
- If `usage_policy.X === false` for any item, that item is excluded from the corresponding downstream path
- Handshake-level policy is an upper bound; item-level refines and restricts further

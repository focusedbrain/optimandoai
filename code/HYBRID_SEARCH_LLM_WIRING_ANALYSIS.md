# Code Analysis: Hybrid Search + LLM Wiring

**Date:** 2025-03-07  
**Scope:** Trace every configuration and execution path for Hybrid Search, LLM selection, and handshake context.

---

## 1. EXTENSION SETTINGS — API KEY STORAGE

### Where is the Extension Settings UI?
- **Electron app:** `apps/electron-vite-project/src/components/SettingsView.tsx` — **Relay setup only** (no API keys)
- **Extension:** `apps/extension-chromium/src/components/LlmSettings.tsx` (per `LLM_INTEGRATION_V2.md`) — LLM/API key UI is in the **extension**, not the Electron app

### Where are API keys stored?
- **OCR/Vision:** `apps/electron-vite-project/electron/main/ocr/router.ts` — `CloudAIConfig.apiKeys` (OpenAI, Claude, Gemini, Grok)
- **Storage backend:** `apps/electron-vite-project/electron/main/orchestrator-db/service.ts` — encrypted SQLite key-value store
- **HTTP API:** `GET /api/orchestrator/get`, `POST /api/orchestrator/set` — `main.ts` lines 5774–5796
- **Chrome extension:** Likely uses `chrome.storage` or syncs to orchestrator via `/api/orchestrator/sync`

### Exact key/field names
- OCR types: `apps/electron-vite-project/electron/main/ocr/types.ts` lines 128–130 — `apiKeys: Partial<Record<VisionProvider, string>>` where `VisionProvider` = `'OpenAI' | 'Claude' | 'Gemini' | 'Grok'`
- No explicit `getApiKey(provider)` found — OCR router reads `config.apiKeys[provider]` directly

### Accessibility
- **Main process:** Orchestrator service is in main process; HTTP API is exposed to extension
- **Renderer:** No direct access; extension fetches via HTTP to Electron backend

### Status
| Item | Status | Notes |
|------|--------|-------|
| API key storage | **Partially implemented** | Orchestrator + OCR config; extension LlmSettings UI exists |
| API key retrieval | **Stub** | No `getApiKey(provider)`; OCR has its own config |
| Extension → Electron sync | **Unknown** | Extension may sync to orchestrator; need to trace |

---

## 2. BACKEND CONFIGURATION — LOCAL LLM (OLLAMA)

### Where is the Backend Configuration UI?
- **Extension sidepanel:** `apps/extension-chromium/src/sidepanel.tsx` — fetches `/api/llm/status`, `/api/llm/models`, etc.
- **Electron app:** No dedicated "Backend Configuration" or "Runtime Controls" component in `src/`; LLM UI is in the **extension**

### Ollama service
- **File:** `apps/electron-vite-project/electron/main/llm/ollama-manager.ts`
- **Class:** `OllamaManager`
- **Endpoint:** `http://127.0.0.1:11434` (hardcoded in constructor, line 24)
- **Port:** `ollamaPort: 11434` (line 16)

### Functions
| Function | Location | Line |
|----------|----------|------|
| `listModels()` | `ollama-manager.ts` | ~229 |
| `chat(modelId, messages)` | `ollama-manager.ts` | ~280+ |
| `getStatus()` | `ollama-manager.ts` | ~198 |
| `start()` / `stop()` | `ollama-manager.ts` | ~114, ~176 |

### HTTP API (Ollama)
| Endpoint | Handler | Location |
|----------|---------|----------|
| `GET /api/llm/status` | `ollamaManager.getStatus()` | main.ts:5907 |
| `GET /api/llm/models` | `ollamaManager.listModels()` | main.ts:5943 |
| `POST /api/llm/chat` | `ollamaManager.chat(modelId, messages)` | main.ts:6060 |

### Local vs Cloud preference
- **OCR:** `CloudAIConfig.preference` — `'cloud' | 'local' | 'auto'` (ocr/types.ts:132)
- **Handshake chat:** No explicit preference; `handshake:chatWithContext` expects `getLLMChat()` from vault service (never wired)

### Vector DB
- **Embeddings:** Stored in `context_embeddings` table (SQLite) — `embeddings.ts` line 67
- **Same as handshake:** Yes — `context_blocks` + `context_embeddings` are handshake-specific
- **Vector DB config:** None; cosine similarity is computed in-memory (embeddings.ts:168–169)

### Status
| Item | Status | Notes |
|------|--------|-------|
| Ollama connection | **Working** | Extension uses HTTP API |
| Ollama prompt execution | **Working** | `POST /api/llm/chat` |
| Local vs cloud preference | **OCR only** | Not in handshake/chat path |

---

## 3. SEARCH BAR LLM SELECTOR

### HybridSearch component
- **File:** `apps/electron-vite-project/src/components/HybridSearch.tsx`

### Model selector
- **Location:** Lines 315–356 — dropdown shown only in **Chat** mode
- **State:** `selectedModel` (line 148), default `'gpt-4o'`
- **Storage:** Component state only — **not persisted**; resets on unmount

### Options (hardcoded)
```typescript
// Lines 24–36
const LOCAL_MODELS = [
  { id: 'llama3', label: 'Llama 3' },
  { id: 'mistral', label: 'Mistral 7B' },
  { id: 'phi3', label: 'Phi-3' },
]
const API_MODELS = [
  { id: 'gpt-4o', label: 'GPT-4o' },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  ...
]
```

### Connection to config
- **Not connected** — options are hardcoded
- **No** fetch of Ollama models or API keys
- **No** mapping of `selectedModel` to actual backend

### Status
| Item | Status | Notes |
|------|--------|-------|
| LLM selector UI | **Working** | Renders dropdown |
| Options source | **Stub** | Hardcoded |
| Selection persistence | **Missing** | Component state only |
| Connection to Ollama/API config | **Missing** | No wiring |

---

## 4. SEARCH EXECUTION PATH

### HybridSearch submit flow
- **Handler:** `handleSubmit` (line 189)
- **Search mode:** `runSearch(query, scope)` → `window.handshakeView?.semanticSearch?.(query, scope, 20)`
- **Chat mode:** `runChat(query, scope, selectedModel)` → `window.handshakeView?.semanticSearch?.(query, scope, 5)` — **model is ignored**

### runSearch (lines 69–103)
- **Input:** `query`, `scope`
- **Output:** `SearchResult[]`
- **Backend:** `semanticSearch` IPC
- **Error handling:** `vault_locked`, `no_embeddings` → special UI messages

### runChat (lines 105–131)
- **Input:** `query`, `scope`, `_model` (unused)
- **Output:** `string` (formatted summary)
- **Backend:** **Same as runSearch** — `semanticSearch` only; formats results as summary text
- **No LLM call** — Chat mode does NOT call any LLM

### Existing connection to semantic search
- **Connected:** `semanticSearch` IPC
- **Not connected:** Embeddings (requires `getEmbeddingService()`), LLM (requires `chatWithContext` or equivalent)

### Expected flow (not implemented)
1. Search: query → semantic search → results ✓ (partially)
2. Chat: query → semantic search → context blocks → LLM with context → answer ✗

### Status
| Item | Status | Notes |
|------|--------|-------|
| Search mode | **Partially working** | Uses semanticSearch; fails if no embedding service |
| Chat mode | **Stub** | No LLM; just formats search results |
| Scope mapping | **Mismatch** | See below |

---

## 5. SCOPE MAPPING

### HybridSearch scope values
- `'context-graph'` | `'capsules'` | `'attachments'` | `'all'`

### semanticSearch handler
- **File:** `apps/electron-vite-project/electron/main/handshake/ipc.ts` lines 1064–1085
- **Filter logic:** Only sets `filter.handshake_id` if `scope.startsWith('hs-')`; `filter.relationship_id` if `scope.startsWith('rel-')`
- **For** `'context-graph'`, `'capsules'`, etc.: filter stays `{}` → **searches all handshakes**

### Implications
- Scope `'context-graph'` does not restrict to a specific handshake
- `'capsules'` and `'attachments'` are **not implemented** in backend — no separate tables for them

---

## 6. EMBEDDING SERVICE

### Definition
- **File:** `apps/electron-vite-project/electron/main/handshake/embeddings.ts`
- **Interface:** `LocalEmbeddingService` (lines 22–25) — `modelId`, `generateEmbedding(text)`

### Model
- **Not implemented** — `LocalEmbeddingService` is an interface; no concrete implementation
- **TODO:** `TODO-NEXT.md` line 15 — "Implement LocalEmbeddingService with MiniLM, BGE-small"

### Usage
- **processEmbeddingQueue:** `embeddings.ts` line 28 — **never called** (only exported)
- **semanticSearch:** `embeddings.ts` line 89 — requires `embeddingService` from `vs?.getEmbeddingService?.()`

### getEmbeddingService
- **Source:** `(globalThis as any).__og_vault_service_ref?.getEmbeddingService?.()`
- **Assigned:** **Never** — `__og_vault_service_ref` is never set in codebase
- **Result:** `embedding_unavailable` → search fails

### Status
| Item | Status | Notes |
|------|--------|-------|
| Embedding service interface | **Defined** | LocalEmbeddingService |
| Concrete implementation | **Missing** | No MiniLM/BGE/etc. |
| processEmbeddingQueue | **Never called** | No background indexing |
| getEmbeddingService | **Never provided** | __og_vault_service_ref not set |

---

## 7. IPC / PRELOAD BRIDGE

### Search-related IPC
| Method | Handler | Location |
|--------|---------|----------|
| `handshake:semanticSearch` | `handleHandshakeRPC('handshake.semanticSearch', ...)` | main.ts:2246 |
| `handshake:chatWithContext` | Direct IPC handler | main.ts:2305 |

### Preload
- **File:** `apps/electron-vite-project/electron/preload.ts`
- **semanticSearch:** `ipcRenderer.invoke('handshake:semanticSearch', query, scope, limit)` — line 264
- **chatWithContext:** `ipcRenderer.invoke('handshake:chatWithContext', systemMessage, dataWrapper, user)` — line 274

### handshake:chatWithContext handler
```typescript
// main.ts:2305
const vs = (globalThis as any).__og_vault_service_ref
const llmChat = vs?.getLLMChat?.()
if (llmChat) {
  const response = await llmChat.complete(messages)
  return response
}
return 'LLM chat backend is not connected.'
```
- **getLLMChat:** Never provided — `__og_vault_service_ref` is never set

### handshake.semanticSearch RPC
```typescript
// ipc.ts:1064
const vs = (globalThis as any).__og_vault_service_ref
const embeddingService = vs?.getEmbeddingService?.()
if (!embeddingService) return { success: false, error: 'embedding_unavailable' }
```
- **getEmbeddingService:** Never provided

### Missing IPC
- No `getAvailableLLMs()` — would need to list Ollama models + API-configured providers
- No `sendPromptToLLM(modelId, messages)` — extension uses HTTP `/api/llm/chat`; handshake uses IPC with broken getLLMChat

### Status
| Item | Status | Notes |
|------|--------|-------|
| semanticSearch IPC | **Exposed** | Preload + main |
| semanticSearch handler | **Broken** | Depends on getEmbeddingService |
| chatWithContext IPC | **Exposed** | Preload + main |
| chatWithContext handler | **Broken** | Depends on getLLMChat |
| getAvailableLLMs IPC | **Missing** | Would need new method |

---

## 8. STATE MANAGEMENT

### Global state
- **No Redux/Zustand** for LLM config
- **Props/context:** Passed down; no global LLM store

### LLM config availability
- **Extension:** Fetches `/api/llm/*` via HTTP
- **Electron app:** `HybridSearch` has no access to LLM config

### Events
- No `onApiKeysChanged` or `onOllamaModelsChanged` event

### Status
| Item | Status | Notes |
|------|--------|-------|
| Global LLM state | **Missing** | No store |
| HybridSearch → config | **No path** | Would need IPC or HTTP |
| Config change events | **Missing** | No pub/sub |

---

## 9. SUMMARY TABLE

| Component/Function | Status | Notes |
|--------------------|--------|-------|
| API key storage | Partially | Orchestrator + OCR; extension LlmSettings |
| API key retrieval | Stub | No getApiKey; OCR has own config |
| Ollama connection | Working | Extension → HTTP /api/llm/* |
| Ollama prompt execution | Working | POST /api/llm/chat |
| Embedding generation | Missing | LocalEmbeddingService not implemented |
| Embedding indexing (background) | Missing | processEmbeddingQueue never called |
| Semantic search function | Implemented | embeddings.ts semanticSearch() |
| Semantic search IPC exposure | Exposed | Broken without getEmbeddingService |
| HybridSearch → search backend | Partial | Uses semanticSearch; fails if no embedding |
| HybridSearch → chat backend | Stub | No LLM; formats search results |
| LLM selector → actual LLM config | Missing | Hardcoded options |
| Search results → LLM for chat answer | Missing | runChat doesn't call LLM |
| Governance filtering on search | Working | filterBlocksForSearch in embeddings |

---

## 10. BLOCKERS

1. **__og_vault_service_ref never set** — `getEmbeddingService` and `getLLMChat` are never provided; semantic search and chatWithContext fail.
2. **No LocalEmbeddingService** — No embedding model for search; embeddings table stays empty.
3. **processEmbeddingQueue never called** — No background indexing of context blocks.
4. **HybridSearch Chat mode** — Uses semanticSearch only; does not call any LLM.
5. **LLM selector** — Hardcoded; not connected to Ollama models or API config.
6. **Scope semantics** — `'context-graph'` etc. don't map to handshake_id; backend has no capsules/attachments scope.

---

## 11. RECOMMENDED IMPLEMENTATION ORDER

### Phase 1: Minimal working search (no LLM)
1. **Implement LocalEmbeddingService** — Use a local model (e.g. @xenova/transformers with MiniLM) or a small embedding API.
2. **Wire processEmbeddingQueue** — Call from a background job or on context block ingestion; ensure embeddings are populated.
3. **Set __og_vault_service_ref** — Create a gateway object with `getEmbeddingService()` returning the embedding service; assign to `globalThis.__og_vault_service_ref` when vault is unlocked.
4. **Verify semantic search** — HybridSearch Search mode should work.

### Phase 2: Chat mode with LLM
5. **Wire getLLMChat** — Add to gateway: `getLLMChat()` that returns an adapter calling `ollamaManager.chat()` or `/api/llm/chat`; use active model from config.
6. **HybridSearch runChat** — Replace current logic: (a) call semanticSearch for context, (b) build dataWrapper from results, (c) call `chatWithContext(systemMsg, dataWrapper, userMessage)`.
7. **LLM selector** — Fetch available models from `/api/llm/models` + API config; populate dropdown; persist selection.

### Phase 3: Polish
8. **Scope mapping** — Add `activeView` or handshake context to HybridSearch; pass `handshake_id` when in handshakes view.
9. **API model support** — Add cloud LLM path (OpenAI, Claude, etc.) when API keys are configured.
10. **Config change events** — Emit events when models/keys change; refresh HybridSearch UI.

---

## 12. FILE REFERENCE

| File | Purpose |
|------|---------|
| `apps/electron-vite-project/src/components/HybridSearch.tsx` | Search UI, runSearch, runChat |

| `apps/electron-vite-project/electron/main/handshake/embeddings.ts` | processEmbeddingQueue, semanticSearch, LocalEmbeddingService |
| `apps/electron-vite-project/electron/main/handshake/ipc.ts` | handshake.semanticSearch RPC |
| `apps/electron-vite-project/electron/main/handshake/contextGovernance.ts` | filterBlocksForSearch |
| `apps/electron-vite-project/electron/main/handshake/contextBlocks.ts` | getPendingEmbeddingBlocks |
| `apps/electron-vite-project/electron/preload.ts` | semanticSearch, chatWithContext bridge |
| `apps/electron-vite-project/electron/main.ts` | handshake:semanticSearch, handshake:chatWithContext IPC |
| `apps/electron-vite-project/electron/main/llm/ollama-manager.ts` | Ollama lifecycle, listModels, chat |
| `apps/electron-vite-project/electron/main/ocr/router.ts` | CloudAIConfig, apiKeys |
| `apps/electron-vite-project/electron/main/orchestrator-db/service.ts` | Key-value storage |
| `apps/electron-vite-project/src/components/HandshakeChatSidebar.tsx` | Uses chatWithContext (broken) |
| `apps/electron-vite-project/src/components/contextEscaping.ts` | buildDataWrapper, prepareContextForLLM |

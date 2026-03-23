# Search Wiring — Verification Report

Run each check **after completing the corresponding sub-task**. Every check must PASS before moving to the next sub-task. If a check fails, fix it before proceeding.

---

## 04-1: Embedding Service Init

### Prerequisites (check before starting)
| # | Check | Pass/Fail |
|---|-------|-----------|
| P1 | Ollama is running (`curl http://127.0.0.1:11434/api/tags` returns 200) | ☐ Manual |
| P2 | Embedding model installed (`ollama list` shows `nomic-embed-text` or similar) | ☐ Manual |
| P3 | Vault can be unlocked successfully | ☐ Manual |
| P4 | At least 1 active handshake with context blocks exists | ☐ Manual |

### Implementation checks
| # | Check | How to verify | Pass/Fail |
|---|-------|---------------|-----------|
| 1.1 | `LocalEmbeddingService.generateEmbedding()` is implemented | `embeddings.ts`: `OllamaEmbeddingService.generateEmbedding()` calls Ollama `/api/embed` endpoint | ✅ Pass |
| 1.2 | `LocalEmbeddingService.isAvailable()` is implemented | `embeddings.ts`: `OllamaEmbeddingService.isAvailable()` checks Ollama via `/api/tags` | ✅ Pass |
| 1.3 | `__og_vault_service_ref` is set on vault unlock | `vault/rpc.ts`: `setupEmbeddingServiceRef(vaultService)` called in `vault.unlock` success path | ✅ Pass |
| 1.4 | `getEmbeddingService()` returns valid service after vault unlock | Add `console.log` after unlock — must not be null/undefined | ☐ Manual |
| 1.5 | `processEmbeddingQueue()` is called after vault unlock | `setupEmbeddingServiceRef` calls `processEmbeddingQueue` via `setImmediate` | ✅ Pass |
| 1.6 | Embeddings generated for existing context blocks | After unlock, wait 10–30s; `SELECT COUNT(*) FROM context_embeddings` > 0 | ☐ Manual |
| 1.7 | Semantic search IPC no longer returns `embedding_unavailable` | DevTools: `await window.handshakeView.semanticSearch('test','all',5)` — returns results or `[]`, not error | ☐ Manual |
| 1.8 | No crash on vault lock/unlock cycle | Unlock → lock → unlock → embedding service reinitializes without errors | ☐ Manual |

**Note:** Checklist mentions `/api/embeddings`; Ollama uses `/api/embed` (singular). Implementation is correct.

---

## 04-2: Wire LLM Selector

### Prerequisites
| # | Check | Pass/Fail |
|---|-------|-----------|
| P1 | 04-1 passes all checks | ☐ |
| P2 | At least one Ollama chat model installed (e.g., `llama3`, `mistral`, `phi3`) | ☐ Manual |

### Implementation checks
| # | Check | How to verify | Pass/Fail |
|---|-------|---------------|-----------|
| 2.1 | `handshake.getAvailableModels` IPC handler exists | `main.ts`: `handshake:getAvailableModels` handler in `ipcMain.handle` | ✅ Pass |
| 2.2 | Handler returns Ollama models when Ollama is running | DevTools: `await window.handshakeView.getAvailableModels()` — lists models with `provider: 'ollama'` | ☐ Manual |
| 2.3 | Handler returns empty local models when Ollama is stopped | Stop Ollama, repeat call — `models` returns (empty local) without crashing | ☐ Manual |
| 2.4 | Handler returns cloud models when API keys configured | Configure API key in Extension Settings → call `getAvailableModels()` — includes that provider | ☐ Manual |
| 2.5 | Handler returns no cloud models when no API keys | Remove API keys, call again — cloud section empty | ☐ Manual |
| 2.6 | Preload bridge method exists | `preload.ts`: `getAvailableModels` defined on `handshakeView` | ✅ Pass |
| 2.7 | LLM selector dropdown shows real models | Open search bar, click LLM selector — shows Ollama under "Local", cloud under "Cloud" | ☐ Manual |
| 2.8 | Hardcoded `LOCAL_MODELS` and `API_MODELS` are removed | `HybridSearch.tsx`: No `LOCAL_MODELS` or `API_MODELS` | ✅ Pass |
| 2.9 | Selecting a model updates the dropdown display | Click a model — button/label updates to selected model name | ☐ Manual |
| 2.10 | No models state is handled | Stop Ollama + remove API keys → selector shows "No models configured" or similar | ☐ Manual |

---

## 04-3: Wire Search Display

### Prerequisites
| # | Check | Pass/Fail |
|---|-------|-----------|
| P1 | 04-1 passes all checks (embeddings exist) | ☐ |
| P2 | `context_embeddings` table has entries (check 1.6 passed) | ☐ |

### Implementation checks
| # | Check | How to verify | Pass/Fail |
|---|-------|---------------|-----------|
| 3.1 | Search mode returns results for relevant queries | Type a word from context blocks → results appear | ☐ Manual |
| 3.2 | Each result shows a content snippet | Results display truncated content from matching block | ✅ Pass |
| 3.3 | Each result shows relevance score | Score bar/percentage in `ResultRow` | ✅ Pass |
| 3.4 | Each result shows handshake attribution | Source line: counterparty, sent/received, date, handshake ID | ✅ Pass |
| 3.5 | Each result shows block type and classification | Badge for `data_classification` | ✅ Pass |
| 3.6 | "View in handshake" link/button exists on each result | `ResultRow` has button that copies handshake ID | ✅ Pass |
| 3.7 | Empty state displays correctly | Search gibberish → "No matching context found" | ✅ Pass |
| 3.8 | Scope filter works | Switch scopes (all, context-graph, etc.) — results change or stay consistent | ☐ Manual |
| 3.9 | No console errors during search | DevTools console, several searches — no red errors | ☐ Manual |
| 3.10 | Search works after vault lock/unlock | Lock → search shows vault locked → unlock → search works again | ☐ Manual |

---

## 04-4: Wire Chat RAG Pipeline

### Prerequisites
| # | Check | Pass/Fail |
|---|-------|-----------|
| P1 | 04-1, 04-2, 04-3 all pass | ☐ |
| P2 | At least one chat-capable LLM available | ☐ Manual |

### Implementation checks
| # | Check | How to verify | Pass/Fail |
|---|-------|---------------|-----------|
| 4.1 | `handshake.chatWithContextRag` handler is implemented (not stub) | `main.ts`: Handler runs semantic search + LLM call logic | ✅ Pass |
| 4.2 | Handler runs semantic search first | Console.log before LLM call — search results in logs | ☐ Manual |
| 4.3 | Handler builds context string from search results | Log `contextText` — block content with source labels | ☐ Manual |
| 4.4 | Ollama chat works | Select local model, ask question in Chat mode → answer appears | ☐ Manual |
| 4.5 | Answer contains source citations | LLM response includes `[Source 1]`, `[Source 2]` | ☐ Manual |
| 4.6 | Sources list displays below the answer | `chatSources` rendered with "View in handshake" buttons | ✅ Pass |
| 4.7 | Cloud LLM works (if API key configured) | Select cloud model, ask question → answer appears | ☐ Manual |
| 4.8 | Error: vault locked | Lock vault → Chat mode → "Unlock your vault" message | ✅ Pass |
| 4.9 | Error: Ollama not running | Stop Ollama, select local model, chat → "Ollama is not running" | ✅ Pass |
| 4.10 | Error: no API key | Select cloud model with no key → "No API key" message | ✅ Pass |
| 4.11 | Error: no search results | Ask unrelated question → LLM says not enough info | ☐ Manual |
| 4.12 | Preload bridge for `chatWithContextRag` exists | `preload.ts`: `chatWithContextRag` defined | ✅ Pass |
| 4.13 | Loading state shows during LLM call | Spinner/"Asking…" until response arrives | ✅ Pass |
| 4.14 | No crash on rapid repeated queries | Submit 3 queries quickly → queues or handles gracefully | ☐ Manual |

---

## 04-5: Governance Filter

### Prerequisites
| # | Check | Pass/Fail |
|---|-------|-----------|
| P1 | 04-4 passes all checks | ☐ |
| P2 | At least 2 handshakes with different governance policies | ☐ Manual |

### Implementation checks
| # | Check | How to verify | Pass/Fail |
|---|-------|---------------|-----------|
| 5.1 | `filterBlocksForCloudAI` called before building LLM context | `main.ts`: `chatWithContextRag` filters blocks when `isCloud` before `contextText` | ✅ Pass |
| 5.2 | Local model sees all blocks | Chat with Ollama about "No AI" block → answer includes that content | ☐ Manual |
| 5.3 | Cloud model does NOT see restricted blocks | Chat with OpenAI/Claude about "No AI" block → answer excludes it | ☐ Manual |
| 5.4 | Cloud model sees permissive blocks | Chat with cloud about "Cloud AI allowed" block → answer includes it | ☐ Manual |
| 5.5 | Governance note appears when blocks are filtered | `chatGovernanceNote` displayed when cloud filters blocks | ✅ Pass |
| 5.6 | Governance note suggests using local model | Note text: "Use a local model to access all results" | ✅ Pass |
| 5.7 | Search results include governance summary | `ResultRow` shows `governance_summary` badge | ✅ Pass |
| 5.8 | "Internal AI only" blocks allowed for Ollama | Blocks with `local_only` appear in Ollama context | ☐ Manual |
| 5.9 | "Internal AI only" blocks excluded for cloud | Same blocks excluded from cloud context | ☐ Manual |
| 5.10 | No governance data → defaults to allowed | Blocks with null/empty `governance_json` included for all providers | ☐ Manual |

---

## Master Summary

| Sub-task | Total checks | Code-verified | Manual remaining |
|----------|-------------|---------------|------------------|
| 04-1 Embedding Init | 8 | 4 | 4 |
| 04-2 LLM Selector | 10 | 3 | 7 |
| 04-3 Search Display | 10 | 6 | 4 |
| 04-4 Chat RAG | 14 | 6 | 8 |
| 04-5 Governance | 10 | 4 | 6 |
| **TOTAL** | **52** | **23** | **29** |

**Minimum viable search:** 04-1 + 04-3 (18 checks)  
**Minimum viable chat:** 04-1 + 04-2 + 04-4 (32 checks)  
**Full pipeline:** All 52 checks pass.

---

## Changes Made for Verification

1. **Governance summary in search results (5.7):** Added `governance_summary` to `SearchResult`, `runSearch` mapping, and `ResultRow` badge.
2. **Governance note in chat (5.5, 5.6):** Added `chatGovernanceNote` state, display when blocks are filtered, and `governanceNote` in `handshakeViewTypes` return type.

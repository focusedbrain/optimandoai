# Phase 4: Cloud-Backed Execution Path — Implementation Report

## What was done

### 1. Cloud provider dispatch in Electron backend

Extended `POST /api/llm/chat` in `electron/main.ts` to accept optional `provider` and `apiKey` fields in the request body. When both are present, the request is dispatched to the cloud provider's API instead of Ollama. All four cloud providers are supported:

| Provider   | API Endpoint                                               | Auth Header                        |
|------------|------------------------------------------------------------|------------------------------------|
| OpenAI     | `https://api.openai.com/v1/chat/completions`               | `Authorization: Bearer <key>`      |
| Anthropic  | `https://api.anthropic.com/v1/messages`                    | `x-api-key: <key>`                 |
| Gemini     | `https://generativelanguage.googleapis.com/v1beta/...`     | `?key=<key>` query param           |
| Grok (xAI) | `https://api.x.ai/v1/chat/completions`                    | `Authorization: Bearer <key>`      |

The `dispatchCloudChat` function reuses the exact API patterns already proven in `handshake/aiProviders.ts`. Response shape is normalized to `{ ok: true, data: { content: '...' } }`, matching the existing Ollama response contract.

### 2. API key path unification

**Problem**: API keys were saved to page `localStorage` in the content-script settings overlay. The sidepanel (separate extension context) could not access `localStorage` — keys were stored but never read for LLM calls.

**Solution**:
- Modified `saveApiKeys()` in `content-script.tsx` to also sync keys to `chrome.storage.local` under the key `optimando-cloud-api-keys`.
- Modified `loadApiKeys()` to sync existing keys to `chrome.storage.local` on load (covers keys saved before this fix).
- Added `getCloudApiKey(provider)` in `processFlow.ts` that reads from `chrome.storage.local`, mapping `ProviderId` → storage key name (e.g., `'openai'` → `'OpenAI'`).

### 3. Brain resolution for cloud providers

Updated `resolveModelForAgent()` in `processFlow.ts`:
- Cloud providers (`openai`, `anthropic`, `gemini`, `grok`) now return `ok: true` with `isLocal: false`.
- When model is `'auto'` or empty, a default model is used from `CLOUD_DEFAULT_MODELS`.
- Added `'no_api_key'` to `BrainErrorType` for future use.
- `Image AI` provider now returns a clearer error explaining it's for image generation, not chat.

### 4. LLM call sites updated with API key injection

Added `buildLlmRequestBody()` in `processFlow.ts` — builds the JSON body for `/api/llm/chat`:
- For local providers: `{ modelId, messages }` (unchanged).
- For cloud providers: reads API key via `getCloudApiKey()`, adds `provider` and `apiKey` to the body.
- Returns an error string if a cloud key is required but missing.

Updated all three agent LLM call sites in `sidepanel.tsx`:
1. `processWithAgent` (~line 2549)
2. `processScreenshotWithTrigger` (~line 1243)
3. `handleSendMessageWithTrigger` (~line 2738)

Each call site now:
- Calls `buildLlmRequestBody()` after successful brain resolution.
- If API key is missing, writes a visible warning to the Agent Box and chat, then skips execution.
- If API key is present, sends the enriched body to `/api/llm/chat`.

Butler/fallback LLM calls remain unchanged (always local).

### 5. Provider constants extended

Added to `src/constants/providers.ts`:
- `CLOUD_DEFAULT_MODELS`: Default model per cloud provider for `'auto'` selection.
- `PROVIDER_API_KEY_NAMES`: Maps `ProviderId` → storage key name for API key retrieval.

## Where provider dispatch lives

Centralized in the Electron backend (`electron/main.ts` → `dispatchCloudChat`). The extension sends `provider` and `apiKey` in the request body, and the backend handles all HTTP calls to cloud APIs. This keeps secrets in transit only between the extension and the local Electron app (127.0.0.1), never exposed in extension-side HTTP calls to external services.

## Files touched

| File | Change |
|------|--------|
| `electron-vite-project/electron/main.ts` | Added `dispatchCloudChat()`, extended `/api/llm/chat` to handle `provider`+`apiKey` |
| `extension-chromium/src/constants/providers.ts` | Added `CLOUD_DEFAULT_MODELS`, `PROVIDER_API_KEY_NAMES` |
| `extension-chromium/src/services/processFlow.ts` | Updated `resolveModelForAgent` for cloud, added `getCloudApiKey`, `buildLlmRequestBody`, `LlmRequestBody` type |
| `extension-chromium/src/sidepanel.tsx` | Updated 3 LLM call sites to use `buildLlmRequestBody`, imported new function |
| `extension-chromium/src/content-script.tsx` | Synced API keys to `chrome.storage.local` in both `saveApiKeys()` and `loadApiKeys()` |

## Hidden prerequisites discovered

1. **API key storage split**: Keys were in page `localStorage` (content-script context), completely inaccessible from the sidepanel context. This was the root cause of "keys exist but aren't used."

2. **Subscription gate on key save**: `saveApiKeys()` is blocked unless `window.optimandoHasActiveSubscription === true`. For testing without a subscription, testers can run `window.optimandoHasActiveSubscription = true` in the content-script console before saving keys.

3. **Anthropic API message format**: Anthropic requires `system` as a top-level parameter and non-system messages in the `messages` array. The cloud dispatch correctly separates system messages.

4. **Gemini API structure**: Gemini uses `contents[].parts[].text` instead of `messages[].content`. The dispatch maps the standard format.

5. **Existing cloud implementations**: `handshake/aiProviders.ts` already had working implementations for all four providers. The new dispatch reuses those exact patterns.

## UI controls: what was addressed

- **Cloud providers**: No longer misleading — they now execute for real.
- **API key fields**: Now actually used — synced to `chrome.storage.local`.
- **Image AI provider**: Error message updated to clearly explain it's for image generation, not text chat.
- **Tools, WR Experts, Execution Mode workflows**: These remain persisted-only and are clearly separate advanced features that don't interfere with basic E2E testing. Modifying their UI in a 45K-line file carries more risk than benefit at this stage.

## What remains for later

- **Streaming**: Cloud responses are non-streaming (complete response). Streaming can be added later using the patterns in `handshake/llmStream.ts`.
- **Token limits / rate limiting**: No max_tokens configuration exposed in the UI yet.
- **API key validation before execution**: Keys are checked for presence but not validated against the provider API before the call.
- **Multiple API key storage backends**: Currently only `chrome.storage.local`. The vault-based key storage in `hsContextProfilesRpc.ts` is a separate system.
- **Cloud model catalog**: Model dropdowns show static placeholder lists. Dynamic model listing from cloud APIs is not implemented.

---

## Validation Checklist

### Scenario 1: Valid OpenAI key → real cloud execution
1. Open Settings overlay → API Keys section.
2. Enter a valid OpenAI API key in the OpenAI field.
3. Click Save. (Requires `optimandoHasActiveSubscription = true`.)
4. Create or edit an Agent Box: set Provider to "OpenAI", Model to "gpt-4o-mini".
5. Send a message in WR Chat that matches the agent's listener.
6. **Expected**: Agent output appears in the Agent Box with a real OpenAI response. Console shows `[HTTP-LLM] Cloud dispatch: openai gpt-4o-mini`.

### Scenario 2: Missing API key → visible error
1. Ensure no API key is saved for Claude/Anthropic.
2. Create an Agent Box with Provider "Claude", Model "auto".
3. Send a message that matches the agent's listener.
4. **Expected**: Agent Box shows `⚠️ No API key found for Claude. Add your Claude API key in Settings → API Keys, then try again.` Chat also shows the warning.

### Scenario 3: Invalid API key → cloud error propagated
1. Enter an invalid/expired API key for OpenAI (e.g., `sk-invalid123`).
2. Trigger the agent.
3. **Expected**: Agent Box shows an error from OpenAI (e.g., "OpenAI 401: ..."). The error is visible, not silent.

### Scenario 4: Local path still works
1. Configure an Agent Box with Provider "Local AI", Model set to an installed Ollama model.
2. Trigger the agent.
3. **Expected**: Local model executes as before. No regression.

### Scenario 5: Sidepanel and grid box delivery
1. Create a cloud-provider Agent Box in the sidepanel.
2. Trigger it. Verify output in sidepanel box.
3. Create a cloud-provider Agent Box in the display grid.
4. Trigger it. Verify output in grid box.
5. **Expected**: Both surfaces receive output correctly.

### Scenario 6: Image AI provider → clear error
1. Create an Agent Box with Provider "Image AI".
2. Trigger the agent.
3. **Expected**: Error message says "Image AI is for image generation, not text chat. Select a different provider."

---

## What is now truly end-to-end functional

After Phases 1–4:
- **Local Ollama execution**: WR Chat → agent match → local model → Agent Box output (sidepanel + grid).
- **OpenAI execution**: WR Chat → agent match → OpenAI cloud → Agent Box output (sidepanel + grid).
- **Anthropic execution**: WR Chat → agent match → Anthropic cloud → Agent Box output.
- **Gemini execution**: WR Chat → agent match → Gemini cloud → Agent Box output.
- **Grok execution**: WR Chat → agent match → Grok/xAI cloud → Agent Box output.
- **OCR-aware routing**: Image text participates in agent matching before execution.
- **Visible error handling**: Missing keys, wrong providers, and API errors are surfaced visibly.

## What is intentionally deferred

- Streaming cloud responses
- Dynamic cloud model catalogs
- Token limit / temperature / advanced LLM configuration
- WR Expert runtime wiring
- Tools / plugin runtime execution
- Execution mode workflows beyond "agent response only"
- API key validation before call
- Multi-backend key storage (vault integration)
- Image AI provider (image generation, not chat)

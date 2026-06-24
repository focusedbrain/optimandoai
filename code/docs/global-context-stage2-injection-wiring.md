# Global Session Context — Stage 2: Injection wiring (Scope A)

**Depends on:** Stage 1 committed and verified (`global-context-stage1-key-normalization.md`).  
**Scope:** Direct text injection only — **no RAG, no embeddings, no vectorization**.  
**Authoritative prior traces:** `trace-global-session-context`, `trace-connected-models-and-session-key`.

**Do not merge to main until Stage 2 rig verification passes.**

---

## Target architecture (two layers)

| Layer | Source | Reaches | Storage |
|-------|--------|---------|---------|
| **1 — Global Session Context** | User / Publisher / Account text (+ PDF text extracted at save if present) | **ALL models connected to orchestrator session S** | `user_context_${S}`, `publisher_context_${S}`, `optimando_account_context` |
| **2 — Mode Structured Context Fields** | `profileFields` on active custom mode | **That mode’s allocated model only** | Custom modes store (`customModeTypes.ts:83`, `formatCustomModeProfileFieldsForPrefix` @ `320-328`) |

**Layering order** on a user message (or host `focusPrefix`):

```
[Global Session Context — user]
[Global Session Context — publisher]
[Account context]
[Mode Structured Context Fields]     ← allocated model only (Layer 2)
--- user turn / OCR / routing text ---
```

For **non-allocated** agent-box models in the same session: **Layer 1 only** (no `profileFields`).

**Frozen:** Host/sealed transport unchanged — global context attaches as **message bytes** the extension already sends (`wrChatHostInferenceShared.ts:116-121`, `main.ts` host-internal-completion). No new main-process store for prompts.

---

## Prerequisites from Stage 1

- `resolveOrchestratorSessionKeyForInference()` returns the **same** key used by `loadAgentsFromSession(sessionKeyForRoute)`.
- `globalSessionContextStorageKeys(sessionKey)` used everywhere.

---

## Stage 2 deliverable A: Load + format helper

### New module (recommended)

`apps/extension-chromium/src/lib/globalSessionContextLlmPrefix.ts`

```typescript
export type GlobalSessionContextBlob = {
  text: string
  pdfFiles?: Array<{ name?: string; dataUrl?: string }>
}

export type LoadedGlobalSessionContext = {
  user: GlobalSessionContextBlob | null
  publisher: GlobalSessionContextBlob | null
  account: GlobalSessionContextBlob | null
}

/** Async read from chrome.storage via storageWrapper / chrome.storage.local */
export async function loadGlobalSessionContext(sessionKey: string | null): Promise<LoadedGlobalSessionContext>

/** Sync formatting — metadata only in logs; no full body logging */
export function formatGlobalSessionContextForLlmPrefix(loaded: LoadedGlobalSessionContext): string | null
```

### Format rules (Scope A — direct injection)

- Include **textarea `text`** for each non-empty section.
- PDFs: inject **already-saved** text if present on blob; do **not** add OCR pipeline in Stage 2 unless blobs already store extractable text. If only `dataUrl` exists, optional one-line placeholder: `[PDF attached: filename]` (product decision — document in PR).
- Section headers (readable in both themes):
  - `[Session context — user]\n…`
  - `[Session context — publisher]\n…`
  - `[Account context]\n…`
- Cap total injected chars (e.g. 32k combined) with deterministic truncation — document limit constant.
- Return `null` if all sections empty.

### Merge helper

```typescript
export function mergeLlmContextPrefixesWithGlobalSession(
  globalBlock: string | null,
  chatFocusPrefix: string | null,
  modeProfileFieldsPrefix: string | null,
): string | null
```

Order: `globalBlock` → `chatFocusPrefix` → `modeProfileFieldsPrefix` (see layering above).

---

## Stage 2 deliverable B: Wire Layer 1 at every session-connected invocation point

From `trace-connected-models-and-session-key` — **must wire**:

### WR Chat — sidepanel

| Path | Model | Inject at (file:line) | Notes |
|------|-------|----------------------|--------|
| Main send — butler + agents | `effectiveLlmModel` / box models | `sidepanel.tsx:4070-4072` merge; `4188-4189` prepend | Split today’s merge: global first, then mode profileFields |
| Host/sealed | Host wire model | `4097` `focusPrefix`; `wrChatHostInferenceShared.ts:116-121` | Prepend global into `focusPrefix` only |
| Trigger host | Host | `3503` `focusPrefix: mergedContextPrefixTrigger` | Same |
| `processWithAgent` | Box-resolved | `3228-3230` system/user assembly | Global on user content or shared prepend |
| Trigger agent | Box-resolved | `3583-3588` user content | |
| Screenshot agent | Box-resolved | `1568-1571` | **Fix:** use enriched text + global (today omits mode prefix too) |
| Butler direct | Inherited model | `3353-3356` messages to `/api/llm/chat` | Global in processed messages |

**Session key at inject time:** `resolveOrchestratorSessionKeyForInference({ modeSessionId, sidepanelSessionKey: sessionKey })` — same as `sessionKeyForRoute` @ `4012`.

### WR Chat — PopupChatView (+ dashboard embed)

| Path | Inject at (file:line) |
|------|----------------------|
| Shared merge | `getMergedChatLlmPrefix()` @ `346-350` — add async global load wrapper at send sites |
| Local/butler prepend | `1447-1448` |
| Host extension | `1332-1350`, trigger variants ~1667+, 2088+ |
| Fetch bodies | `1508-1574`, `1941+`, `2254+` |

Dashboard embed uses same `PopupChatView` — covered by above.

### Mode-run / automation

| Path | Inject at (file:line) |
|------|----------------------|
| Agent LLM messages | `modeRunExecution.ts:204-208` before `buildLlmRequestBody` |
| Callers | `background.ts:89-96`, `content-script.tsx` BEAP run (~44822+) — pass `explicitSessionKey` to resolver |

**Layer 2 at mode-run:** add `getCustomModeLlmPrefixForWrChat(activeMode)` when mode-run uses mode’s allocated model (same helper as WR Chat after scam-watchdog split).

### Replace stub button

| File:line | Change |
|-----------|--------|
| `content-script.tsx:26976-26979` | Remove `alert(...)`. Call shared `loadGlobalSessionContext` + confirm saved keys match resolver; optionally trigger sidepanel refresh or show “Context ready for next inference” — **must not** duplicate divergent save logic. |

---

## Stage 2 deliverable C: Layer 2 (profileFields) — extend coverage

**Already works (WR Chat send)** via `getCustomModeLlmPrefixForWrChat()`:

- `customModeLlmPrefix.ts:64-76` — profileFields only (no mode analysis instructions)
- `sidepanel.tsx:4072`, `PopupChatView.tsx:349`

**Still missing Layer 2** (add in Stage 2):

| Path | File:line |
|------|-----------|
| Mode-run automation | `modeRunExecution.ts:204-208` |
| Screenshot trigger agent | `sidepanel.tsx:1571` |
| Trigger agent (if not using shared prepend) | `3583-3588` |

**Do not** put `searchFocus` / scan prompts in Layer 2 (mode behavior belongs on mode RUN paths only — see scam-watchdog chat/scan split).

---

## Explicitly excluded from Layer 1 (unless product expands scope)

| Path | Reason |
|------|--------|
| Watchdog scan | No orchestrator session key (`watchdogService.ts:430-568`) |
| HybridSearch / inbox chat | BEAP/inbox context, not `user_context_*` (`HybridSearch.tsx:2073+`) |
| Optimization dashboard LLM | Project-scoped (`optimizationLlmAdapter.ts`) |
| `BEAP_GENERATE_DRAFT` | No session context (`background.ts`) |
| Host peer selector rows | Not orchestrator session models |

---

## Implementation pattern (per send handler)

```typescript
const canonicalKey = resolveOrchestratorSessionKeyForInference({
  modeSessionId: getActiveCustomModeRuntime()?.sessionId,
  sidepanelSessionKey: sessionKey,
})
const globalBlock = formatGlobalSessionContextForLlmPrefix(
  await loadGlobalSessionContext(canonicalKey),
)
const modeProfileBlock = getCustomModeLlmPrefixForWrChat(getActiveCustomModeRuntime())
const isAllocatedModel = /* effective model === mode override or explicit allocation rule */
const mergedPrefix = mergeLlmContextPrefixesWithGlobalSession(
  globalBlock,
  getChatFocusLlmPrefix(useChatFocusStore.getState()),
  isAllocatedModel ? modeProfileBlock : null,
)
// prepend mergedPrefix to last user message / focusPrefix / processedMessages
```

**Allocated-model rule:** When `getEffectiveLlmModelNameForActiveMode()` returns mode’s `modelName` override, apply Layer 2. Agent-box models use Layer 1 only unless box model equals allocated model (edge case — document in code comment).

---

## Host / sealed path note

Extension builds `hostMessages` → HTTP/IPC. Global block must be in `focusPrefix` or last user content **before** `runWrChatHostInferenceForExtensionSurface` (`sidepanel.tsx:4117-4125`). Main process must not need changes if messages already carry the prefix.

---

## Stage 2 verification (rig + tests)

### Unit tests

1. `formatGlobalSessionContextForLlmPrefix` — empty → null; user+publisher+account ordering; truncation.
2. `mergeLlmContextPrefixesWithGlobalSession` — global before profileFields.
3. Mock storage: save under `user_context_session_X`, load with resolver `session_X` → text present.
4. **Regression:** WR Chat host message preflight does **not** contain scan JSON (`Respond ONLY with a JSON object`) — unrelated but run alongside.

### Manual rig checks

1. Set Global Session Context user text **“RIG_GLOBAL_MARKER_1”** for active session **S**.
2. WR Chat sidepanel + Host AI → response reflects marker (or inspect dev log of prefix length / hash).
3. WR Chat popup → same.
4. Agent-box model (non-allocated) → receives marker; does **not** receive another mode’s profileFields.
5. Mode with profileFields + allocated model → marker **and** profile field labels in prefix.
6. Mode-run / BEAP automation → marker present.
7. Account context text → appears on all above paths.
8. **Inject Context** button → no alert; confirms keys aligned with **S**.
9. Switch session **S → T** → marker from **T**, not **S**.
10. Watchdog scan still returns threat JSON when appropriate (unchanged).

### Stage 2 exit criteria

- [ ] Layer 1 wired at all §“must wire” sites.
- [ ] Layer 2 on allocated-model paths + mode-run + screenshot fix.
- [ ] Stub button replaced.
- [ ] Unit tests pass.
- [ ] Rig checklist signed off.
- [ ] Stage 1 + Stage 2 commits on branch; then merge to main.

---

## File checklist (expected diff footprint)

| Area | Files |
|------|--------|
| Load/format | `globalSessionContextLlmPrefix.ts` (new) |
| Resolver (Stage 1) | `resolveOrchestratorSessionKey.ts` |
| WR Chat | `sidepanel.tsx`, `PopupChatView.tsx`, `wrChatHostInferenceShared.ts` (callers only) |
| Mode-run | `modeRunExecution.ts`, `background.ts` |
| UI stub | `content-script.tsx:26976-26979` |
| Tests | `globalSessionContextLlmPrefix.test.ts`, resolver tests from Stage 1 |
| Optional | `processFlow.ts` if butler path needs central prepend |

---

## Commit message hint

`feat(context): inject global session context at all orchestrator LLM paths (Scope A direct text)`

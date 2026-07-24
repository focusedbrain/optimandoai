# Global Session Context — Stage 1: Key normalization

**Scope:** Direct text injection only (no RAG/embeddings).  
**Prerequisite for:** Stage 2 injection wiring.  
**Authoritative prior traces:** `trace-global-session-context`, `trace-connected-models-and-session-key` (branch `feature/latency-warmup` @ 6d7b3512).

**Do not proceed to Stage 2 until Stage 1 verification passes on the rig.**

---

## Problem statement

Global Session Context is **saved** under chrome.storage keys derived from one session-key resolver, but **would be read** (Stage 2) using a **different** resolver at inference time. When save-key ≠ read-key, injection loads **empty or wrong-session** context with **no error** — the highest-risk silent failure.

Today:

| Side | Resolver | Storage / usage |
|------|----------|-----------------|
| **Save** (Global Context UI) | `getCurrentSessionKey()` in content-script | `user_context_${sessionKey}`, `publisher_context_${sessionKey}` |
| **Read** (proposed WR Chat) | `mode.sessionId \|\| sidepanel.sessionKey` | Same key pattern — but different source |
| **processFlow async** | `getCurrentSessionKeyAsync()` | Only `chrome.storage.local['optimando-active-session-key']` |

No inference path reads these keys yet; Stage 1 fixes the key contract **before** any prompt bytes are wired.

---

## Ground truth (file:line)

### Save-side key (Global Context Management)

| What | File:line |
|------|-----------|
| UI entry: Unified Admin → “Global Context Management” tab | `content-script.tsx:10764` |
| Lightbox: `openContextLightbox()` | `content-script.tsx:26012-26078` |
| Session key at open/save | `getCurrentSessionKey()` @ `content-script.tsx:26019` |
| Storage key patterns | `user_context_${sessionKey}` @ `26026`, `publisher_context_${sessionKey}` @ `26028`, `optimando_account_context` @ `26030` |
| Save handler writes keys | `content-script.tsx:27011-27019` |
| Stub “Inject Context to LLMs” (not implemented) | `content-script.tsx:26976-26979` |

**`getCurrentSessionKey()` resolution** (`content-script.tsx:2655-2697`):

1. `sessionStorage['optimando-current-session-key']` (this tab)
2. else `localStorage['optimando-global-active-session']`
3. else `null` → session-scoped keys are **not written** (`26026-26028`)

**Session id format when created:** `session_${Date.now()}_${random}` (`content-script.tsx:2895`).

**`setCurrentSessionKey(key)`** writes all three mirrors (`content-script.tsx:2703-2727`):

- `sessionStorage['optimando-current-session-key']`
- `localStorage['optimando-global-active-session']`
- `chrome.storage.local['optimando-active-session-key']`

### Read-side keys (inference — today used for routing, not context)

| What | File:line |
|------|-----------|
| WR Chat route / agent load key | `sessionKeyForRoute = getActiveCustomModeRuntime()?.sessionId?.trim() \|\| sessionKey` @ `sidepanel.tsx:4012` |
| Sidepanel mirrors `sessionKey` → chrome.storage | `sidepanel.tsx:1829-1837` |
| Sidepanel boot: most recent SQLite session | `sidepanel.tsx:2207-2242` (may ≠ active tab) |
| Mode wizard `sessionId` pick | `StepSession.tsx:114-117` (orchestrator `session_*` / `archive_session_*`) |
| processFlow async key | `getCurrentSessionKeyAsync()` @ `processFlow.ts:298-304` — **only** `optimando-active-session-key` |
| processFlow sync fallback | `getCurrentSessionKey()` @ `processFlow.ts:315-326` — localStorage global, then sessionStorage |
| Dashboard bootstrap | `wrChatDashboardBootstrap.ts:83-84` — sets `optimando-active-session-key` + `optimando-global-active-session` |
| Dashboard chrome shim read | `wrChatDashboardChrome.ts:78-81` |
| Mode-run session | `modeRunExecution.ts:114-120`, callers pass `sessionKey` / `modeLinkedSessionId` |

### Divergence scenarios (must be eliminated by Stage 1)

| Scenario | Save key | Read key (WR Chat today) | Result if wired naively |
|----------|----------|--------------------------|-------------------------|
| Mode on **session_B**, tab active **session_A** | `user_context_session_A` | `sessionKeyForRoute` = **session_B** (mode `sessionId` wins) | **Wrong/empty** |
| Mode without `sessionId`, sidepanel **A**, tab **B** | `user_context_session_B` | `sessionKeyForRoute` = **session_A** | **Wrong/empty** |
| Sidepanel = latest SQLite, tab = different session | Tab key | Sidepanel key | **Wrong/empty** |
| `getCurrentSessionKey()` null at save | Nothing saved to `user_context_*` | Any read | **None** |

**Account context** is global: always `optimando_account_context` — not session-keyed (`content-script.tsx:26030`).

---

## Stage 1 deliverable: one canonical resolver

### New module (recommended location)

`apps/extension-chromium/src/lib/resolveOrchestratorSessionKey.ts`  
(Shared by extension + importable from electron dashboard shim paths.)

### API (minimum)

```typescript
/** Canonical orchestrator session id: session_* | archive_session_* | null */
export function normalizeOrchestratorSessionKey(raw: string | null | undefined): string | null

/** Keys used for Global Session Context chrome.storage reads/writes */
export function globalSessionContextStorageKeys(sessionKey: string): {
  userContextKey: string
  publisherContextKey: string
  accountContextKey: 'optimando_account_context'
}

/**
 * Single resolver for BOTH save and read.
 * Priority MUST match agent/box loading (same session the inference run belongs to).
 */
export function resolveOrchestratorSessionKeyForInference(ctx?: {
  /** Explicit override — mode-run / BEAP callers */
  explicitSessionKey?: string | null
  /** Sidepanel React state sessionKey */
  sidepanelSessionKey?: string | null
  /** Active custom mode wizard link */
  modeSessionId?: string | null
}): string | null
```

### Resolution priority (normative)

Must align with `sessionKeyForRoute` / `loadAgentsFromSession` usage:

1. `ctx.modeSessionId` (active mode `sessionId` when mode is active)
2. `ctx.explicitSessionKey` (mode-run, BEAP, callers that already pass session)
3. `ctx.sidepanelSessionKey` (WR Chat sidepanel state)
4. `chrome.storage.local['optimando-active-session-key']` (async-safe; same mirror as `setCurrentSessionKey`)
5. `localStorage['optimando-global-active-session']` (dashboard / legacy)
6. `sessionStorage['optimando-current-session-key']` (content-script tab — **last**; tab may lag sidepanel)

**Reject** non-orchestrator keys (empty, `session_fallback`, bare tab ids without `session_` prefix unless product explicitly allows).

### Storage key constants

Centralize — do not scatter string templates:

| Constant | Value |
|----------|--------|
| `GLOBAL_ACCOUNT_CONTEXT_KEY` | `optimando_account_context` |
| User session prefix | `user_context_` + canonical session key |
| Publisher session prefix | `publisher_context_` + canonical session key |
| Active session mirror | `optimando-active-session-key` |
| Global active mirror | `optimando-global-active-session` |
| Tab session mirror | `optimando-current-session-key` |

---

## Stage 1 code touch points (replace ad-hoc resolution)

### A. Save path — Global Context UI

| File | Change |
|------|--------|
| `content-script.tsx:26019-26030` | Replace `getCurrentSessionKey()` with `resolveOrchestratorSessionKeyForInference({ sidepanelSessionKey: … })` **or** show explicit session id in lightbox header and save under **that** resolved key |
| `content-script.tsx:27015-27019` | Use `globalSessionContextStorageKeys(resolvedKey)` |

**On lightbox open:** resolve and **display** the target session id in the UI (user must see which session they are editing). Optional: sync mirrors via existing `setCurrentSessionKey(resolvedKey)` when opening if product wants tab + sidepanel aligned.

### B. Read path prep (no injection yet — only resolver calls)

Add resolver usage at inference **decision points** without loading context yet; log resolved key in dev:

| File:line | Variable to replace / augment |
|-----------|-------------------------------|
| `sidepanel.tsx:4012` | `sessionKeyForRoute` — must call shared resolver |
| `sidepanel.tsx:3475`, `1501` | trigger / screenshot route keys |
| `processFlow.ts:416`, `607`, `1279` | replace inline async key with resolver |
| `modeRunExecution.ts` callers | pass `explicitSessionKey` |
| `PopupChatView.tsx` `getOrchestratorSessionKeyForSync()` @ ~87 | align with shared resolver |
| `wrChatDashboardBootstrap.ts:83-84` | after bootstrap, resolver should return same key |

### C. Deprecate duplicate helpers

| Helper | Action |
|--------|--------|
| `content-script.tsx:getCurrentSessionKey()` | Thin wrapper → shared resolver (tab context) |
| `processFlow.ts:getCurrentSessionKey()` / `getCurrentSessionKeyAsync()` | Delegate to shared module |
| `SensorWorkflow.ts:245` | Uses wrong key (`optimando-active-session-key` only) — fix in Stage 1 or document exclusion |

---

## Stage 1 verification (rig + unit tests)

### Unit tests (required before commit)

1. **Priority order:** mode `sessionId` beats sidepanel beats chrome.storage beats localStorage beats sessionStorage.
2. **Normalization:** trims whitespace; rejects empty; accepts `session_*` and `archive_session_*`.
3. **Key builder:** `globalSessionContextStorageKeys('session_123')` → `user_context_session_123`, etc.
4. **Save/read parity:** same `resolveOrchestratorSessionKeyForInference` input → same storage keys on save and read paths.

### Manual rig checks (required before commit)

1. Open Global Context lightbox → note displayed session id **S**.
2. Open sidepanel WR Chat with mode linked to **S** → resolver log shows **S**.
3. Open sidepanel with mode linked to **B** while tab on **A** → lightbox must show which session is being edited; save under **S** must not use tab **A** unless UI explicitly targets **A**.
4. Save user context text → confirm chrome.storage has `user_context_<S>` with that text (DevTools → Application → Extension storage).
5. Switch sidepanel session → `optimando-active-session-key` updates (`sidepanel.tsx:1831-1837`) and resolver returns new key.
6. Dashboard WR Chat after `ensureOrchestratorSessionForDashboard()` → resolver matches sidepanel parity key (`wrChatDashboardBootstrap.ts:83-84`).

### Stage 1 exit criteria

- [ ] Single shared resolver module exported and used at all listed touch points.
- [ ] Global Context save uses resolver output for `user_context_*` / `publisher_context_*` keys.
- [ ] Lightbox shows target session id (no silent wrong-session save).
- [ ] Unit tests pass.
- [ ] Rig verification checklist signed off.
- [ ] **No prompt injection yet** — Stage 2 only after this commit.

---

## Explicitly out of scope (Stage 1)

- Loading context text into LLM messages (Stage 2).
- RAG / embeddings / vectorization.
- Syncing `session.context` blob on SQLite session record (optional future; save today does not write blob — `trace-global-session-context`).
- Watchdog / HybridSearch / inbox context families (different stores).
- Sealed transport changes.

---

## Commit message hint

`fix(context): unify orchestrator session key resolver for global context save/read parity`

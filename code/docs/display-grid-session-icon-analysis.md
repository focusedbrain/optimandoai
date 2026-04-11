# Display Grid Session Icon Analysis

**Shipped implementation:** see the concise architecture and regression checklist in [`display-grid-integration-default-badge.md`](./display-grid-integration-default-badge.md). This document remains the deeper pre-implementation analysis.

## 1. Executive Summary

**Feasibility:** Showing a user-assigned **integration default automation** icon as a **read-only badge** on display grid pages is technically feasible because:

- Grid tabs already carry the **orchestrator session key** (`sessionKey` URL parameter) set when opening the grid from the master tab (`openGridWindowWithExtensionURL` / `openGridWindow_v2` in `content-script.tsx`).
- Grid pages are **extension pages** with access to `chrome.storage.local`, where integration-default metadata is stored under a **single well-known key** (`beap_integration_default_automation_v1` per `integrationDefaultAutomationMetadata.ts`).
- The integration record already includes **`defaultSessionKey`** (intended to be the working-copy session tied to that integration) and **`defaultAutomationIcon`** (emoji, short glyph, or `https:` / `data:` URL per comments in that file).

**Safest direction:** Treat the icon as **presentation-only**: resolve it at runtime (or on storage change) via a **read-only lookup** from integration metadata keyed by matching `defaultSessionKey` to the grid’s `sessionKey`. **Do not** treat the grid UI as source of truth; **do not** persist a second copy on `displayGrids[]` in the first experiment unless product explicitly wants offline denormalization— that adds drift risk.

**Important gap (confirmed in repo):** Integration metadata is **integration-keyed**, not session-keyed. There is **no** existing helper that maps `sessionKey → icon`; an implementation must **scan** `byIntegrationKey` or introduce a small index. Also, **V1** and **V2** grid shells use **different restore paths** (SQLite message vs `chrome.storage.local`); any icon hook should be aware both exist.

---

## 2. Current Display Grid Architecture

### Where grids are defined and stored

| Concern | Location | Notes |
|--------|----------|--------|
| Session field | `session.displayGrids` | Array on the session object persisted under `session_*` keys in `chrome.storage.local` and synchronized with in-memory `currentTabData.displayGrids` in `content-script.tsx` (many references; e.g. merge ~2998–3018, `persistGridConfig` ~36490–36638). |
| Grid entry shape (typical) | `persistGridConfig` | Entries include `layout`, `sessionId` (grid instance id), `url`, `timestamp`, and after save `config: { layout, sessionId, slots }`. |
| Open URL | `openGridWindowWithExtensionURL`, `openGridWindow_v2` | `chrome.runtime.getURL('grid-display.html' \| 'grid-display-v2.html')` + query: `layout`, `session`, `theme`, **`sessionKey`**, `nextBoxNumber`. |

### Rendering and restore

| Variant | Primary files | Restore / hydration behavior (confirmed) |
|--------|---------------|-------------------------------------------|
| **V2** | `apps/extension-chromium/public/grid-display-v2.html` (inline script), `grid-script-v2.js` | `loadSavedConfig()` calls `chrome.storage.local.get([sessionKey])`, reads `session.displayGrids`, matches **`layout` + `sessionId`** from URL (fallback: `layout` only), picks newest by `timestamp`, then `buildGrid(gridEntry.config.slots)`. |
| **V1** | `grid-display.html`, `grid-display.js`, `grid-script.js` | `grid-display.js` uses `GET_SESSION_FROM_SQLITE` with `sessionKey`, maps agent boxes to slots via **`locationId`** pattern (`grid_{sessionId}_{layout}_slot{N}`) documented in file header—not the same code path as V2’s `displayGrids` filter. |

### Per-slot metadata

- **V2:** Slot header is built in `buildGrid` inside `grid-display-v2.html`: shows `abCode`, fixed **���️** glyph (not agent icon), `displayText` (title / model / provider), Clear / Edit / Close. Saved config comes from `savedSlots[slotKey]` on each slot’s `data-slot-config`.
- **V1:** Slot creation in `grid-display.js` (not fully quoted here); `grid-script.js` references `parentSessionKey` / `GRID_CONFIG.sessionKey` for saves and SQLite.

### Creation / persistence (orchestrator side)

- **`persistGridConfig`** (`content-script.tsx` ~36490+): Ensures `activeSessionKey` via `getCurrentSessionKey()`, loads session from `storageGet`, finds or creates `displayGrids[]` entry by **`layout`**, writes `gridEntry.config.slots`, saves session blob back with `storageSet`.
- **`saveGridToSession` / `createGridTab`** (~35429+): Pushes simpler grid records (`layout`, `sessionId`, `url`, `timestamp`) before full config exists.

---

## 3. Current Session-to-Grid Relationship

### How the code ties a grid to a session

1. **Authoritative link for the open tab:** Query parameter **`sessionKey`** is the orchestrator storage key for the session that was active when the grid was opened (`openGridWindow*` passes `getCurrentSessionKey()` in normal flow).
2. **Within that session blob:** `displayGrids[]` lists grids; each has its own **`sessionId`** (e.g. `grid_${Date.now()}…`) distinguishing multiple open grids of the same layout.
3. **V2 matching:** When loading config, the shell prefers `g.layout === layout && g.sessionId === sessionId`, else falls back to `layout` only and picks the newest `timestamp`—**confirmed** in `grid-display-v2.html` `loadSavedConfig`.

### Explicit vs implicit

- **Explicit** in data: `session.displayGrids` belongs to the session object keyed by `sessionKey`; each grid row references `sessionId` + `layout` + `config`.
- **Implicit:** The browser tab’s association is “whatever `sessionKey` was passed in the URL”; if the user changes active session in another tab without reopening the grid, the grid tab **does not automatically** get a new URL (no evidence in repo of cross-tab URL sync for grids).

### Most reliable stable key

- **`sessionKey`** (orchestrator session id, e.g. `session_…`) for “which session this grid belongs to.”
- **`sessionId` (URL `session` param)** for “which grid instance within that session’s `displayGrids` list” when disambiguating multiple grids of the same layout.

---

## 4. Existing Default Automation / Integration Icon Metadata

### Storage location and access

- **File:** `apps/extension-chromium/src/beap-messages/integrationDefaultAutomationMetadata.ts`
- **Chrome key:** `BEAP_INTEGRATION_DEFAULT_AUTOMATION_STORAGE_KEY` = `'beap_integration_default_automation_v1'`
- **Shape:** `BeapIntegrationDefaultAutomationRootV1`: `{ schemaVersion: 1, byIntegrationKey: Record<string, BeapIntegrationDefaultAutomationEntryV1> }`
- **Entry fields (relevant):** `integrationKey`, `identity`, `defaultSessionKey`, `defaultAutomationLabel`, `defaultAutomationIcon`, `updatedAt`

### Keying model

- **Integration-keyed:** `integrationKey` = `beapIntegrationStableKey(identity)` where `identity` is derived from **`BeapMessage.senderFingerprint`** and **`handshakeId`** (`beapIntegrationIdentityFromMessage`).
- **`defaultSessionKey`:** “Working-copy session storage key designated as the default automation for messages from this integration” (comment in file)—**session-related but the record is not stored under `session_*`**.

### Where it is written / read today

- **Read/write UI:** `BeapMessageDetailPanel.tsx` uses `getBeapIntegrationDefaultAutomationEntry(integrationStableKey)` and `upsertBeapIntegrationDefaultAutomationEntry(...)`.
- **No usage in:** `grid-display*.html`, `grid-script*.js`, or `content-script.tsx` grid openers (grep shows metadata only under `beap-messages/`).

### Can a grid resolve the icon “directly”?

- **Not without a mapping step:** Given only `sessionKey`, the store is organized by **`integrationKey`**, not by session. Resolution requires either:
  - **Reverse lookup:** find entry(ies) where `entry.defaultSessionKey === sessionKey`, then read `defaultAutomationIcon`, or
  - **Denormalized field** on the session object or on each `displayGrids[]` element (not present today).

---

## 5. Feasibility of Rendering the Icon in Display Grids

### Can it be done safely?

- **Yes, as a badge:** Extension grid pages already use `chrome.storage` (V2 loader) and `chrome.runtime.sendMessage` (V1 / scripts). Reading `beap_integration_default_automation_v1` is consistent with existing permissions.
- **CSP / img:** `grid-display-v2.html` CSP includes `img-src 'self' data: https:`—**https / data URLs** for icons align with integration metadata comments; local file URLs would need verification.

### Clean insertion points (grounded in current DOM)

| Option | Pros | Cons |
|--------|------|------|
| **Fixed corner badge** (e.g. top-left), sibling to `#grid-root` | Does not mix with per��️** / AB header; clear “page chrome” | Must not overlap fullscreen control (currently bottom-right in V2). |
| **Narrow strip above `#grid-root`** | Reads like “session header” | Slightly reduces grid viewport. |
| **`document.title` augmentation** | Trivial | Poor visibility; conflates with layout title. |
| **Inside every slot header** | High visibility | **Highest confusion risk** with agent/box affordances (slot already shows AB +��️). |

**Recommendation from code structure:** Prefer **one page-level badge** (top-left or thin bar above the grid), **not** inside slot headers, to avoid conflation with slot/agent UI.

### Existing patterns

- V2 uses a **fixed-position fullscreen button** (`#fullscreen-btn`); a **similar fixed badge** pattern would be consistent.
- Slots use a **monospace AB code + emoji + text** header—no reusable “badge component,” but the styling is straightforward inline styles.

---

## 6. Recommended Source-of-Truth Model

| Approach | Truth | Drift risk | Notes |
|----------|--------|------------|--------|
| **A. Read-only lookup** from `beap_integration_default_automation_v1` using `defaultSessionKey === gridSessionKey` | Integration metadata remains canonical | Low if lookup is always from storage; icon updates when storage updates | May need rule if **multiple** entries match one `defaultSessionKey` (not forbidden by schema—**missing product evidence**). |
| **B. Copy icon onto session blob** when user saves in BEAP panel | Session snapshot | Medium: session could be duplicated/imported without the field | Requires writer changes in save path. |
| **C. Copy onto each `displayGrids[]` entry** | Grid record | Higher: N duplicates per session | Harder to keep in sync when icon changes. |
| **D. URL query param** | None (stale) | High | Not recommended except as optional cache hint. |

**Recommended for first experiment:** **A** — read-only presentation lookup by `sessionKey`, optionally subscribe to `chrome.storage.onChanged` for `beap_integration_default_automation_v1` to refresh without reload (grid pages already use `chrome.storage.onChanged` for theme in `grid-display.js`).

**Semantic clarity:** Tooltip should state the icon is **“Integration default automation”** (or label from `defaultAutomationLabel` when present), **not** “agent,” “mode trigger,” or “custom mode bar”—matching `integrationDefaultAutomationMetadata.ts` header comments.

---

## 7. Restore and Reconciliation Behavior

### After session restore

- Grid restore uses **`sessionKey`** + **`displayGrids`** (V2) or **SQLite session** + **locationId** (V1). None of these currently include the integration icon.
- **If using lookup A:** As soon as `sessionKey` and storage are available, the badge can resolve; **no** change to grid slot restore order is strictly required.

### Edge cases

| Case | Suggested behavior (product-aligned) |
|------|--------------------------------------|
| No `defaultAutomationIcon` (null/empty) | **Render nothing** (matches “only when explicitly assigned”). |
| No integration row matches `sessionKey` | **Render nothing** (not every session is a BEAP “default automation” target). |
| `defaultSessionKey` mismatch (session renamed/imported) | Lookup fails → **no badge** until metadata updated—**expected** unless denormalized copy exists. |
| Integration identity / fingerprint missing | N/A for grid: grid only has `sessionKey`; lookup is by `defaultSessionKey`. |
| Multiple grids, multiple sessions | Each tab has its own `sessionKey` → independent resolution. |
| Metadata lookup fails (storage error) | **Fail silent**, no badge (same as no match). |

### Live updates

- **Without listener:** User must reload grid tab after changing icon in BEAP inbox.
- **With `storage.onChanged`:** Badge can update when the integration root changes—low risk if handler only updates DOM.

---

## 8. Minimal Experimental Implementation Path

**Status:** Implemented as in [`display-grid-integration-default-badge.md`](./display-grid-integration-default-badge.md). Original sketch below is superseded where it conflicts.

1. **V2:** `grid-display-v2.html` loads `grid-integration-default-badge.js` and calls `tryRender(sessionKey)` after URL params are read.
2. **Resolve:** Reverse lookup on `byIntegrationKey`; **exactly one** matching row with non-empty `defaultAutomationIcon` renders the badge; **zero** matches → no badge; **more than one** match → no badge + `console.warn` (no tie-break).
3. **Render:** Fixed top-left, `pointer-events: none`, `role="img"`; optional `chrome.storage.onChanged` refresh for the integration root key.
4. **V1 parity:** `grid-display.js` uses the same script and `tryRender(sessionKey)`; badge does not depend on SQLite restore.

---

## 9. Risks and Edge Cases

- **Semantic coupling:** Users might confuse a session badge with **agent.icon** (per-agent in session agents array) or **custom mode trigger-bar** (not in integration file; separate product surface). Mitigation: **placement outside slots** + explicit tooltip copy tied to `defaultAutomationLabel` / “integration default.”
- **Many-to-one `defaultSessionKey`:** Schema allows multiple integration keys to point at the same session in theory—**no code found** that prevents it.
- **V1 vs V2 parity:** Only implementing V2 leaves V1 grids without badge unless duplicated—communicate scope.
- **Icon format:** Emoji vs URL: URL loading failures should not break grid; use `<img>` with `onerror` hide or stick to text/emoji for v0.
- **Security:** If icon is user-controlled URL, normal img CSP applies; avoid `javascript:` URLs (not in CSP anyway).

---

## 10. Open Questions / Missing Evidence

1. **Uniqueness:** Is `defaultSessionKey` guaranteed unique across `byIntegrationKey` in practice? (Not enforced in `upsertBeapIntegrationDefaultAutomationEntry`.)
2. **Session key equality:** After import/duplicate session, does `defaultSessionKey` in integration metadata always match the orchestrator key used in grid URLs? (Depends on user workflow—**runtime validation** needed.)
3. **Electron SQLite vs chrome.storage:** Whether `GET_SESSION_FROM_SQLITE` session always matches `chrome.storage.local[sessionKey]` for `displayGrids`—V2 uses **local storage** for grid config; V1 uses SQLite for boxes. **Consistency of `displayGrids` across backends** is not fully traced in this pass.
4. **Multiple BEAP integrations** pointing at the same working session: which icon should win?
5. **Whether** product wants badge on **imported** sessions that were never tied to BEAP integration metadata (likely **no badge**—confirm).

---

## 11. Most Likely First Debug Entry Points

| Order | File / symbol | Why |
|-------|----------------|-----|
| 1 | `content-script.tsx` — `openGridWindowWithExtensionURL`, `openGridWindow_v2` | Confirms **`sessionKey`** and **`session`** query params. |
| 2 | `public/grid-display-v2.html` — `loadSavedConfig`, `buildGrid` | Grid restore and **DOM** insertion point for a badge. |
| 3 | `public/grid-display.js` — `GET_SESSION_FROM_SQLITE` block | V1 hydration differences. |
| 4 | `content-script.tsx` — `persistGridConfig` | How `displayGrids` entries are written. |
| 5 | `integrationDefaultAutomationMetadata.ts` — schema + `getBeapIntegrationDefaultAutomationEntry` | Canonical metadata shape and key names. |
| 6 | `BeapMessageDetailPanel.tsx` — `upsertBeapIntegrationDefaultAutomationEntry` | How `defaultSessionKey` and icon are set in product. |

---

*Originally analysis-only; implementation is documented in [`display-grid-integration-default-badge.md`](./display-grid-integration-default-badge.md).*

# Display grid: integration default automation badge

Concise reference for the **read-only page-level** icon that reflects BEAP “integration default automation” on display grid tabs. Heavier background analysis lives in [`display-grid-session-icon-analysis.md`](./display-grid-session-icon-analysis.md).

## Architecture (source of truth)

| Item | Detail |
|------|--------|
| **Canonical data** | `chrome.storage.local` key `beap_integration_default_automation_v1` (see `integrationDefaultAutomationMetadata.ts`). |
| **Grid session identity** | URL query `sessionKey` (orchestrator session key), set when the grid window opens. |
| **Resolution** | Reverse lookup: scan `byIntegrationKey`; keep rows where `entry.defaultSessionKey === sessionKey` (and entry `schemaVersion === 1`). |
| **Icon field** | `defaultAutomationIcon` (emoji, short text, or `https:` / `data:` URL). Tooltip uses “Integration default automation” plus optional `defaultAutomationLabel`. |
| **Persistence** | None on the grid: the badge is **not** written to `displayGrids`, SQLite slot config, or session blobs. |

## V2 vs V1

| | **V2** | **V1** |
|---|--------|--------|
| **Shell** | `grid-display-v2.html` + `grid-script-v2.js` | `grid-display.html` + `grid-display.js` + `grid-script.js` |
| **Slot / grid restore** | `chrome.storage.local[sessionKey]` + `displayGrids` | `GET_SESSION_FROM_SQLITE` + `locationId` slot mapping |
| **Badge wiring** | Inline loader after URL params → `gridV2IntegrationDefaultBadge.tryRender(sessionKey)` | Same script URL + `tryRender(sessionKey)` immediately after `GRID_CONFIG` in `grid-display.js` |
| **Parity** | Primary target | **Optional parity**: same script and semantics; badge does **not** depend on SQLite. |

The global `window.gridV2IntegrationDefaultBadge` name is historical; both grids use it.

## Why page-level, not slot-level

- Integration default automation is a **session-level association** (`defaultSessionKey`), not per-slot agent metadata.
- Slot headers already encode **agent/box** chrome (AB code, provider/model, controls). Putting the integration icon there would blur **“which agent is in this slot”** vs **“this session is the default automation target for an integration.”**
- A **fixed, non-interactive** corner badge (`pointer-events: none`, `role="img"`) stays semantically separate from slot actions.

## Edge cases (implemented behavior)

| Situation | Behavior |
|-----------|----------|
| No `sessionKey` in URL | No badge. |
| No / invalid metadata root | No badge. |
| Zero matching integrations | No badge. |
| **More than one** row with same `defaultSessionKey` | **No badge** + `console.warn` (ambiguous; no guessing). |
| Single match but empty `defaultAutomationIcon` | No badge. |
| Image URL fails to load | Badge removed + `console.warn`. |
| `chrome.storage.local.get` error | No badge + `console.warn`. |
| Metadata changes while grid is open | `chrome.storage.onChanged` on `local` for `beap_integration_default_automation_v1` triggers re-resolution. |

## Implementation files (rollback)

Revert the feature branch or remove these touch points:

| File | Role |
|------|------|
| `apps/extension-chromium/public/grid-integration-default-badge.js` | All lookup, DOM, storage listener, `tryRender` API. |
| `apps/extension-chromium/public/grid-display-v2.html` | Loads badge script; calls `tryRender(sessionKey)`. |
| `apps/extension-chromium/public/grid-display.js` | V1: same dynamic load + `tryRender(sessionKey)`. |
| `apps/extension-chromium/manifest.config.ts` | `web_accessible_resources` includes `grid-integration-default-badge.js`. |

**Opt-in verbose logs:** add query param `gridBadgeDebug=1` to the grid URL, or in devtools set `window.__GRID_INTEGRATION_BADGE_DEBUG__ = true` and call `gridV2IntegrationDefaultBadge.tryRender(sessionKey)` again. By default, only **warnings** are logged (ambiguous metadata, storage errors, image load failure, exceptions).

## Manual regression checklist

1. **Session with resolvable icon** — V2 and V1 grid URLs with `sessionKey` matching exactly one integration row that has `defaultAutomationIcon` → badge top-left; tooltip mentions integration default; badge does not intercept clicks.
2. **Session without icon** — No matching row, or match has no icon → no badge; grid layout and slots work.
3. **Ambiguous metadata** — Two integration keys share the same `defaultSessionKey` → no badge; console warning lists `integrationKeys`.
4. **Live metadata change** — Grid open; update integration default in BEAP (storage key above changes) → badge appears/updates/clears without full page reload.
5. **No confusion with slot chrome** — Badge is outside `#grid-root` / slot headers; slot edit/toggle/clear unchanged.
6. **Failure isolation** — Corrupt integration blob or storage error → no badge; grid still loads.
7. **Optional debug** — Open grid with `&gridBadgeDebug=1` → extra `console.log` lines with `[grid-integration-default-badge]` for skip reasons and successful render.

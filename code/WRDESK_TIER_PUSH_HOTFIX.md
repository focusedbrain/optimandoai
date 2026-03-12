# WRDesk Tier-Push Hotfix

## Übersicht

Minimal-invasive Änderungen für den Echtzeit-Tier-Wechsel (z. B. pro → publisher) ohne manuellen Re-Login und ohne kurzzeitige Rückstufung auf free.

---

## Implementierte Änderungen

### A — Vault UI (`apps/extension-chromium/src/vault/vault-ui-typescript.ts`)

- **TIER_CHANGED Listener:** `chrome.runtime.onMessage` reagiert auf `type === 'TIER_CHANGED'`
- **handleTierChanged():**
  1. Ruft `getVaultStatus()` auf
  2. Bei Erfolg: `currentVaultTier = status.tier`
  3. Bei Fehler: Fallback auf `event.tier`
- **refreshVaultTierDisplay():** Aktualisiert Badge (`#wrv-tier-badge`) und Sidebar-Kategorien (`#vault-categories`) ohne Page-Reload

### B — Orchestrator (`apps/electron-vite-project/electron/main/p2p/coordinationWs.ts`)

- Bei `system_event` / `tier_changed`:
  1. `setPendingTierOverride(eventTier)` — 60s TTL
  2. `ensureSession(true)` versuchen
  3. `broadcastToExtensions({ type: 'TIER_CHANGED', tier })` — unabhängig vom Refresh-Erfolg

### C — resolveRequestTier (`apps/electron-vite-project/electron/main.ts`)

- `getPendingTierOverride()` berücksichtigt
- Höherer Tier gewinnt: `max(canonical_tier, override.tier)` via `TIER_LEVEL`
- Nach TTL-Ablauf wird Override ignoriert

### D — Logging

- `[TIER_CHANGED_EVENT]` — incoming tier, user id, override stored until
- `[TIER_RESOLUTION]` — canonicalTier, pendingOverride, resolvedTier
- `[VAULT_UI]` — TIER_CHANGED received, status refetched, tier updated / fallback to event tier

---

## WordPress MU-Plugin: Session-Invalidierung

**WICHTIG — Keine Code-Änderung im Repo, aber für den Echtzeit-Pfad relevant:**

Die Session-Invalidierung im MU-Plugin:

```php
wrdesk_kc_invalidate_user_sessions($token, $kc_user_id);
```

kann direkt nach einem `tier_changed` Push den Refresh-Token ungültig machen. Dadurch schlägt `ensureSession(true)` fehl und der User würde ohne `pendingTierOverride` auf free zurückfallen.

**Empfehlung:** Für den Echtzeit-Tier-Push-Pfad diese Invalidierung vorerst **deaktivieren** oder **optional** machen (z. B. über Feature-Flag oder Konfiguration). Der `pendingTierOverride` im Orchestrator überbrückt zwar 60 Sekunden, aber wenn der Refresh-Token invalidiert wird, kann der User danach nicht mehr refreshen bis zum nächsten Login.

---

## Tier-Hierarchie

`enterprise` > `publisher` > `pro` > `free`

---

## Erwartetes Verhalten

- Laufende Vault UI aktualisiert sich sofort bei `tier_changed`
- Kein manueller Re-Login nötig
- Keine falsche Rückstufung auf free direkt nach Planwechsel
- `canonical_tier` bleibt autoritativ
- Event-tier dient nur als kurzfristige Brücke bis Keycloak/Session vollständig nachgezogen hat

# UI Changelog — WRVault Lightbox / Modal

## 2026-02-15 — Enterprise Usability Improvements

### Summary

Widened the vault lightbox, introduced a theme-aware CSS custom property system
that respects the orchestrator theme (Standard / Pro / Dark), improved legibility
by reducing excessive glow and increasing text contrast, and added a collapsible
sidebar.

---

### 1. Wider Lightbox

| Property    | Before            | After                  |
|-------------|-------------------|------------------------|
| `width`     | `90vw`            | `92vw`                 |
| `max-width` | `1000px`          | `1400px`               |
| `height`    | `85vh`            | `88vh`                 |

The **Add Data** dialog was also widened from `max-width: 700px` to `900px` so
that the existing 2-column field grid has more breathing room.

### 2. Theme-Aware Colour System

A set of `--wrv-*` CSS custom properties is injected on the `#wrvault-overlay`
element at open time.  The current orchestrator theme is detected via
`localStorage.getItem('optimando-ui-theme')` (same key used by the sidebar and
MailGuard) and one of three palettes is applied:

| Token               | Pro (default)                | Dark (slate)                | Standard (clean)             |
|---------------------|------------------------------|-----------------------------|------------------------------|
| `--wrv-bg`          | `#0c0c14 → #16162a gradient` | `#0f172a → #1a2035 gradient`| `#141520`                    |
| `--wrv-bg-content`  | `#0e0e14`                    | `#111827`                   | `#111218`                    |
| `--wrv-text`        | `#ededf0`                    | `#f1f5f9`                   | `#e8e8ec`                    |
| `--wrv-accent`      | `#8b5cf6`                    | `#7c3aed`                   | `#7c3aed`                    |
| `--wrv-border`      | `rgba(139,92,246,0.15)`      | `rgba(148,163,184,0.12)`   | `rgba(255,255,255,0.08)`    |
| `--wrv-shadow`      | Reduced from heavy purple glow to `rgba(0,0,0,0.5)` | `rgba(0,0,0,0.6)` | `rgba(0,0,0,0.5)` |

All three palettes keep dark backgrounds (matching the security vault aesthetic)
but differentiate by accent colour, border treatment, and shadow intensity.  No
new colour values were invented — colours are drawn from the existing orchestrator
theme constants in `content-script.tsx`, `sidepanel.tsx`, and
`mailguard-content-script.ts`.

### 3. Reduced Glow / Improved Contrast

* **Container box-shadow** changed from
  `0 25px 50px rgba(139,92,246,0.3), 0 0 100px rgba(0,0,0,0.8)` (heavy purple
  bloom) to a single `var(--wrv-shadow)` — neutral black, theme-appropriate.
* **Container border** softened from `rgba(139,92,246,0.4)` to
  `var(--wrv-border-accent)` (≈ 0.25 opacity for Pro, slate for Dark).
* **Overlay backdrop** reduced from `rgba(0,0,0,0.95)` to `0.85–0.88`,
  matching `--wr-backdrop` values.
* **Label colours** upgraded from `rgba(255,255,255,0.5)` → `var(--wrv-text-3)`
  for improved legibility.
* **Field value colours** upgraded from `rgba(255,255,255,0.7)` →
  `var(--wrv-text-2)` for better readability.
* **Backdrop-filter blur** reduced from `8px` to `6px` for a crisper look.

### 4. Collapsible Sidebar

A small **◀ / ▶** toggle button is now rendered in the sidebar header.  Clicking
it collapses the sidebar to zero-width with a CSS transition (`width`, `min-width`,
`padding`, `opacity` over 0.2 s).  Clicking ▶ restores it.

### 5. Layout & Spacing Tweaks

* Sidebar gap changed from `24px` to `0` (sidebar is now flush with content,
  separated by `border-right`).
* Content area has its own padding (`16px 20px`) for cleaner alignment.
* Font sizes tightened by ~1 px across sidebar labels, buttons, and item cards
  to fit more data in the wider layout.
* Button border-radius reduced from `8px` to `6px` for a tighter, more
  enterprise look.
* Transitions shortened from `0.2s` to `0.15s` for snappier interaction feel.

### 6. Files Changed

| File | Nature of change |
|------|------------------|
| `apps/extension-chromium/src/vault/vault-ui-typescript.ts` | Theme system, widened lightbox, sidebar collapse, CSS var integration across all structural elements and item cards |

### 7. No Breaking Changes

* Existing `ItemCategory` values (`password`, `identity`, `company`, `business`,
  `custom`) are unchanged.
* All existing sidebar categories, sub-tree toggles, and CRUD operations remain
  functional.
* The theme detection is read-only — it reads the same `optimando-ui-theme`
  storage key used elsewhere and defaults to `'pro'` if absent.

---

## 2026-02-15 — Tier-Gated Vault Access & Secrets Category

### Summary

Added the `automation_secret` category as a first-class, functional vault
section accessible to **all tiers including Free**. Gated Password Manager,
Data Manager, Document Vault, and Handshake Context behind Pro+ / Publisher+
tiers via both server-side API route checks and client-side UI filtering.

### 1. New Category: Secrets & API Keys (`automation_secret`)

* `ItemCategory` type extended with `'automation_secret'` in both frontend
  (`extension-chromium`) and backend (`electron-vite-project`) type files.
* `LegacyItemCategory` updated to include `automation_secret`.
* `LEGACY_CATEGORY_TO_RECORD_TYPE`, `RECORD_TYPE_TO_DEFAULT_CATEGORY`, and
  `CATEGORY_UI_MAP` all updated with `automation_secret` entries.
* `AUTOMATION_SECRET_STANDARD_FIELDS` (service name, key name, secret, endpoint,
  expiry, notes) used for the Add/Edit forms — no password-manager semantics
  exposed to Free users.

### 2. Tier-Based Capability Gating (Server Side)

All vault item CRUD routes in `apps/electron-vite-project/electron/main.ts` now
include capability checks **before** data is returned to the client:

| Route               | Gate Behaviour                                        |
|---------------------|-------------------------------------------------------|
| `POST /item/create` | Checks `canAccessCategory(tier, category, 'write')` before encryption/storage. Returns 403 if denied. |
| `POST /item/get`    | Checks category after retrieval, before returning decrypted data. Returns 403 if denied. |
| `POST /items`       | Filters returned items to only include categories the tier can access. |
| `POST /item/update` | Retrieves item first, checks category, then allows update. Returns 403 if denied. |
| `POST /item/delete` | Retrieves item first, checks category, then allows delete. Returns 403 if denied. |
| `POST /status`      | Now includes `tier` field in response for UI gating.  |

The tier is resolved from the module-level `currentTier` variable (set at login
from Keycloak's `wrdesk_plan` claim or role fallback). **Fail-closed**: defaults
to `'free'` if no plan/roles are present.

### 3. Tier-Based UI Gating (Client Side)

**Sidebar:**
* Categories are now built dynamically by `buildSidebarCategoriesHTML(tier)`.
* Accessible categories render as interactive tree nodes (expand/collapse, view
  items, add items).
* Inaccessible categories render as disabled with a `🔒 Pro` or `🔒 Publisher`
  badge and a tooltip.
* Document Vault and Handshake Context remain as "coming soon" placeholders.

**Add Data Dialog:**
* Category dropdown is populated via `getCategoryOptionsForTier(tier)` — only
  shows categories the user can actually create.
* Default pre-selected category is the first allowed option (e.g.,
  `automation_secret` for Free, rather than `password`).

**Add Data Button:**
* The global "Add Data" button now defaults to the first tier-allowed category
  rather than always opening on `password`.

### 4. New Shared Utilities

| Export                      | Description                                         |
|-----------------------------|-----------------------------------------------------|
| `canAccessCategory(tier, cat, action?)` | Bridges legacy `ItemCategory` → `VaultRecordType` → tier check |
| `ALL_ITEM_CATEGORIES`       | Ordered list of all item categories (automation_secret first) |
| `getCategoryOptionsForTier` | Updated to include `automation_secret` and use `ALL_ITEM_CATEGORIES` |

### 5. Tests

28 new vitest tests in `packages/shared/src/vault/vaultCapabilities.test.ts`:

* Free tier: can access `automation_secret` only; all other record types denied
* Pro tier: full access except `handshake_context`
* Publisher tier: full access including `handshake_context`
* Private tier: same as Free (vault features start at Pro)
* Category ↔ RecordType mapping integrity
* Fail-closed: unknown categories return `false`; Free cannot `share`

### 6. Files Changed

| File | Nature of change |
|------|------------------|
| `packages/shared/src/vault/vaultCapabilities.ts` | Extended `LegacyItemCategory`, maps, `getCategoryOptionsForTier`, added `canAccessCategory` and `ALL_ITEM_CATEGORIES` |
| `packages/shared/src/vault/vaultCapabilities.test.ts` | **New** — 28 unit tests for tier gating |
| `apps/extension-chromium/src/vault/types.ts` | Extended `ItemCategory`, re-exports, `VaultStatus.tier` |
| `apps/electron-vite-project/electron/main/vault/types.ts` | Extended `ItemCategory`, re-exports, `VaultStatus.tier` |
| `apps/electron-vite-project/electron/main.ts` | Capability gates on vault CRUD routes, tier in status response |
| `apps/extension-chromium/src/vault/vault-ui-typescript.ts` | Tier-aware sidebar, filtered Add Data dialog, `automation_secret` forms/handlers |

### 7. Backwards Compatibility

* Existing stored `password`, `identity`, `company`, `business`, `custom` items
  remain accessible — they simply require Pro+ tier to read/write.
* A Pro+ user who downgrades to Free will no longer see their password items in
  the UI or API responses, but the encrypted data remains in the vault DB and
  becomes accessible again upon re-upgrading.
* The `automation_secret` category is additive — no existing schema or data is
  modified.

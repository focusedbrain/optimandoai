# Analysis: Dashboard Layout & Space for Inline Composers

**Scope:** Architecture analysis only (no code changes).  
**Prerequisite:** [analysis-composer-popup-architecture.md](./analysis-composer-popup-architecture.md) (Prompt 1) — popups are extension `popup-chat.html`; inline work must fit **`App.tsx` → `app-main`** views.

---

## Section 1: Current Dashboard Layout

### 1A. Main layout structure

#### 1. Root layout component

| Item | Detail |
|------|--------|
| **File** | `apps/electron-vite-project/src/App.tsx` |
| **Root element** | `<div className="app-root">` (**170**) |
| **Layout type** | **Column flexbox:** root is `flex-direction: column`, `height: 100vh` — see `App.css` **251–258** |
| **Children** | `<header className="app-header">` (**171–223**) + `<main className="app-main">` (**225–292**) |

`app-main` (**505–512** in `App.css`) is `flex: 1`, `overflow: hidden`, `display: flex`, `flex-direction: column`, `min-height: 0` — the active view fills the main area below the header.

#### 2. View switching (no React Router for primary tabs)

| Item | Detail |
|------|--------|
| **State** | `activeView: DashboardView` — **`'analysis' \| 'handshakes' \| 'beap-inbox' \| 'settings'`** (**51**). Note: **`settings`** is rendered (**272–273**) but there is **no Settings tab** in the header nav (**175–209**); that path may be unused or reached only by future/deep links. |
| **Mechanism** | Conditional render in **`app-main`** (**226–279**): `handshakes` → `HandshakeView`; `beap-inbox` → `EmailInboxBulkView` or `EmailInboxView` (from **`inboxBulkMode`** **58**, **244–271**); `settings` → `SettingsView`; else → `AnalysisCanvas`. |
| **What renders** | **Analysis:** `AnalysisCanvas` — full-width canvas (`analysis-canvas` **515–521**). **Handshakes:** `HandshakeView` — grid below. **Inbox:** normal or bulk inbox component. |

#### 3. “Three-column” grid — **not one global grid**

The **280px / 320px + 1fr + 320px** mental model applies to **Handshake** and **normal Inbox**, but **column counts and widths differ** by view and selection state.

**Normal inbox (`EmailInboxView`)**

- **Outer grid** (**2211–2223**): `display: grid`, `gridTemplateColumns` from **`gridCols`** (**2208**):
  - **No message selected:** `'320px 1fr 320px'` → **3 columns** (list | center | right import).
  - **Message selected:** `'320px 1fr'` → **2 columns** (list | **one** cell that holds the whole detail workspace).

**Detail workspace when a message is selected** (**2511–2534**, **793–811** in `App.css`):

- Class **`inbox-detail-workspace`**: inner **CSS grid** `grid-template-columns: 1fr 1fr` → **50% message / 50% AI panel** (not a fixed 320px right column).
- **`inbox-detail-workspace--ai-collapsed`**: **`1fr 72px`** — AI column collapses to a narrow strip.

**Handshake view (`HandshakeView`)**

- **Outer grid** (**325–333**): `gridCols = selectedRecord ? '280px 1fr' : '280px 1fr 320px'` — **280px** left list; when no selection, **320px** right pending panel (**444+**).

**Bulk inbox (`EmailInboxBulkView`)**

- Uses **`bulk-view-root`** (**4206+**) — **not** the same 3-column grid; it is a **toolbar + scrollable card grid** layout (different information density and compose FABs similar to normal inbox **5610–5649**).

**Consistency:** The **left rail is ~280–320px** in Handshake/Inbox list views; the **right “AI” region in inbox is half of the remaining width** after the 320px list, **not** a fixed 320px column.

---

### ASCII diagram — current shell (all views)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ app-header (flex-shrink: 0, min-height ~50px)                               │
│  [Logo]  [ Analysis | Handshakes | Inbox⚡ ]     …flex…    [ HybridSearch ]  │
│                                                             (hs-root, max    │
│                                                              ~600px wide)    │
├──────────────────────────────────────────────────────────────────────────────┤
│ app-main (flex:1, min-height:0, overflow hidden)                             │
│                                                                               │
│   ┌──────────── Inbox (message selected) ────────────────────────────────┐  │
│   │ 320px list │  inbox-detail-workspace (grid 1fr | 1fr, margin 12px)      │  │
│   │            │  ┌──────────────────┬──────────────────┐                    │  │
│   │            │  │ EmailMessage   │ InboxDetailAi    │                    │  │
│   │            │  │ Detail         │ Panel (AI)       │                    │  │
│   │            │  └──────────────────┴──────────────────┘                    │  │
│   └────────────────────────────────────────────────────────────────────────┘  │
│                                                                               │
│   (Analysis: full-width AnalysisCanvas; Handshake: 280|1fr[|320]; etc.)      │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

### 1B. Where an inline composer would fit

#### 4. Placement options (pros / cons vs current code)

| Option | Map to current layout | Pros | Cons |
|--------|------------------------|------|------|
| **A — Replace center column** | Swap **`EmailMessageDetail`** (`.inbox-detail-message`) for composer while keeping **`320px`** list + optional right AI. | Uses **`1fr`** width in the detail workspace; room for full BEAP form. | **Loses** inline reading of the open message in that column; reply context must be summarized or duplicated. Today center is **half** of post-list width (**793–795**), not full main area. |
| **B — Replace / expand “right” AI column** | Replace **`InboxDetailAiPanel`** or merge composer into it. | **Message stays visible** in left half of workspace; matches “refine draft in chat bar” story. | Current “right” is **~50% of remaining width**, not 320px; still tight for delivery method + accounts + attachments. **`aiPanelCollapsed`** (**809–811**) already trades width for a **72px** strip. |
| **C — Overlay center + right inside main** | Fixed/absolute panel over **`.inbox-detail-workspace`** (both columns), list column unchanged. | **Wide** compose surface; similar footprint to **`EmailComposeOverlay`** (**2596–2607**: `fixed inset 0`, `z-index 200`) but scoped to main content. | Hides **both** message detail and AI panel unless split/stacked. |
| **D — Dedicated “Compose” `activeView`** | New `DashboardView` + route in **`App.tsx`** **226–279**. | **Full `app-main`** for composer + side lists; clear mode; no fighting 50/50 grid. | **New tab** and navigation state; must sync selection with Inbox/Handshakes. |

#### 5. Reply-heavy use case (current behavior)

- **Native BEAP / handshake messages:** Center shows **`EmailMessageDetail`**; right **`InboxDetailAiPanel`** runs streaming analysis and renders **capsule draft fields** + send paths (see **`EmailInboxView`** capsule sections and **`InboxDetailAiPanel`** starting ~**130**).
- **Plain email:** Reply opens **`EmailComposeOverlay`** (**2133–2139**) or send-via-email flows — **not** the extension popup for reply.
- **Floating [+ BEAP] / [✉+]:** Today call **`openBeapDraft` / `openEmailCompose`** (extension popup) per Prompt 1 — **no** dedicated inline region yet.

**Design directions implied by the code:**

- **Expand the right stack** (Option B+) to host “full” compose controls *or* add a **split center** (message top / composer bottom) inside **`.inbox-detail-message`**.
- **Hybrid:** Option **C** scoped to **`inbox-detail-workspace`** only (not full window) preserves the **320px** list for picking another message.

---

### 1C. Top chat bar (HybridSearch)

#### 6. Positioning and structure

| Question | Answer |
|----------|--------|
| **Sticky/fixed?** | The bar lives in **`app-header`** (**171–223**), which is **`flex-shrink: 0`** (**262–270**). It does not scroll with inbox content — it is **fixed at the top of the app** in the sense of **always visible above `app-main`**. |
| **Full dashboard width?** | **No.** **`HybridSearch`** sits **after** nav in the header flex row. **`.hs-root`** (**HybridSearch.css** **7–15**) is `flex: 0 1 600px`, **`max-width: 600px`**, **`margin-left: auto`** — it occupies the **right portion** of the header, not edge-to-edge. |
| **Above/below tabs?** | **Same row** as brand + **Analysis / Handshakes / Inbox** tabs (**171–223**). |
| **Component** | **`apps/electron-vite-project/src/components/HybridSearch.tsx`** (export default **~306**); styles **`HybridSearch.css`**. |

#### 7. Interaction model and extensibility

- **Draft refine** uses **`useDraftRefineStore`** (`apps/electron-vite-project/src/stores/useDraftRefineStore.ts`): **`DraftRefineTarget`** is **`'email' \| 'capsule-public' \| 'capsule-encrypted'`** (**9**). **`connect`**, **`updateDraftText`**, **`deliverResponse`**, **`acceptRefinement`** wire the top bar to a single active draft string for the selected message (**36–78**).
- **`HybridSearch`** reads the same store (**340–363**) and sets **`data-draft-refine`** on **`.hs-bar`** (**766–768**) when connected to the **current** `selectedMessageId`.
- **Extensibility:** Adding new field types (e.g. **subject**, **context-doc scope**) is **straightforward but not zero-config**: extend **`DraftRefineTarget`** and every **`connect(..., refineTarget)`** / **`updateDraftText`** consumer (e.g. **`EmailInboxView`** **432–495**). **`HybridSearch`** placeholder copy branches on **`refineTarget`** (**850–856**). No plugin registry exists today — **extensible by convention**, **requires coordinated code updates**.

**Views:** HybridSearch receives **`activeView`** and selection IDs (**211–222** in **`App.tsx`**). It adjusts **search scope** defaults (**67–71** in **`HybridSearch.tsx`**) and **inbox sub-focus** via **`useEmailInboxStore`** (**344–359**). It does **not** automatically “see” arbitrary new panels; those must feed **selection + store** the same way.

---

## Section 2: Right Panel (and main) by mode

### 8. What the right panel shows

Interpretation: **Inbox with message selected** uses **`.inbox-detail-ai`** (AI column). **No selection** uses the **third column** “Import & Compose” zone. **Handshakes** use **`HandshakeView`**’s center/right, not `InboxDetailAiPanel`.

| Mode | What shows (approximate) | Code refs |
|------|---------------------------|-----------|
| **Inbox — no selection** | **Column 2:** providers + empty state (**2391–2482**). **Column 3:** “Import & Compose” + **`BeapMessageImportZone`** (**2484–2507**). **No `InboxDetailAiPanel`.** | `EmailInboxView.tsx` |
| **Inbox — message selected** | **`inbox-detail-workspace`:** **`EmailMessageDetail`** + **`InboxDetailAiPanel`** (**2511–2533**). AI: analysis sections, urgency, **capsule draft** text areas for native BEAP, draft send, etc. | Same |
| **Inbox — replying BEAP** | Same layout; user refines in capsule fields; **`handleReply`** for non-plain may **`openBeapDraft`** (popup) (**2140–2142**). Inline capsule + chat refine already on **right + HybridSearch**. | **2133–2143** |
| **Inbox — replying email (plain)** | **`EmailComposeOverlay`** modal (**2134–2139**); not the right column. | **2595+** |
| **Handshakes — selected** | **Center:** **`HandshakeWorkspace`** + **`HandshakeChatSidebar`** (**398–431**). **Right column** only when **no** handshake selected — pending panel (**444+**). Context graph lives in workspace, not in `InboxDetailAiPanel`. | `HandshakeView.tsx` |
| **Compose new BEAP** | **No inline region**; **`openBeapDraft`** → extension popup (Prompt 1). FAB **2574–2591**. | `EmailInboxView.tsx` |
| **Compose new email** | **`openEmailCompose`** → popup, or **`EmailComposeOverlay`** if API missing (**2117–2124**). FAB **2551–2570**. | Same |

---

### 9. Future “compose mode” state (not implemented)

| Topic | Implication |
|-------|-------------|
| **Trigger** | Would need explicit state, e.g. **`composing: 'beap' \| 'email' \| null`** or **`inboxComposeMode`** in **`useEmailInboxStore`** or **`App`**, plus **`gridCols`** / conditional render. **None** of this exists today. |
| **Enter** | Today: **[+ BEAP]** / **[✉+]** call **`analysisDashboard.open*`** (Prompt 1). Inline: same buttons would **set compose mode** instead of IPC. |
| **Exit** | **Send**, **Cancel**, or **navigate away** — mirror **`EmailComposeOverlay` `onClose`** (**2624–2628**) and reset any **`useDraftRefineStore.disconnect()`** if refine was active. |

---

## CSS / component reference (columns)

| Region | Mechanism | Key lines |
|--------|-----------|-----------|
| **app-root / header / main** | Flex column | `App.css` **251–258**, **262–270**, **505–512** |
| **Inbox outer grid** | `gridTemplateColumns` | `EmailInboxView.tsx` **2208–2214** |
| **Detail 50/50** | Grid `1fr 1fr` | `App.css` **793–807**; collapse **809–811** |
| **Handshake outer grid** | Inline style grid | `HandshakeView.tsx` **325–333** |
| **HybridSearch width** | `.hs-root` max 600px | `HybridSearch.css` **7–15** |
| **Email compose overlay** | `position: fixed`, `inset: 0`, `z-index: 200` | `EmailInboxView.tsx` **2596–2603** |

---

## Recommended placement (analysis opinion)

1. **Prefer keeping the message visible for replies:** start from **Option B** — grow **`InboxDetailAiPanel`** (or a tabbed sub-region) to host **delivery + handshake + send**, and allow **resizable** split or **temporary collapse** of analysis sections to reclaim vertical space. **`inbox-detail-workspace--ai-collapsed`** already shows a pattern for trading AI width.
2. **For “new message” with no selected row:** **Option D** or **Option C** inside **`app-main`** avoids squeezing the BEAP builder into **half** of the content area beside an empty message pane; alternatively, treat “no selection” **center + right** (**320px / 1fr / 320px**) as the compose target (**2391–2507** area could become composer instead of empty state + import-only).
3. **Align with HybridSearch:** any new compose field that should refine via the top bar should extend **`DraftRefineTarget`** and **`connect`** in one place (`useDraftRefineStore.ts`) so **`HybridSearch`** stays the single chat entry point.

---

*End of report — input for Analysis Prompt 3 of 4.*

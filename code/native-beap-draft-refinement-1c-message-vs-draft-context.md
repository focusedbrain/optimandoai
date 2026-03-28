# 1C — “Message” Context vs “Draft” Context (Chat Bar)

**Purpose:** Explain how the top chat bar (`HybridSearch`) decides what scope label to show, why a **capsule / draft refine** session can still display **“📨 Message”**, and how that differs from **draft-refinement behavior** (Zustand `useDraftRefineStore`).

**Key finding:** The **visible badge** (“✏️ Draft” vs “📨 Message” vs “📎 Attachment”) is driven by **`uiFocusContext`**, which is derived from **`useEmailInboxStore.subFocus`** only. It does **not** read **`useDraftRefineStore.connected`**. So **“connected to refine draft”** and **“badge says Draft”** are **two different mechanisms** — they can disagree, which matches the screenshot behavior.

---

## 1. What determines the chat bar context label?

### 1.1 The label is not a single string prop

`HybridSearch` does **not** take a prop like `contextLabel="Message"`. It computes a derived value **`uiFocusContext`** (`HybridSearch.tsx` **346–355**) and branches JSX (**675–737**, **816–825**).

### 1.2 Type: `UiFocusContext`

**File:** `HybridSearch.tsx` **8–12**

```ts
export type UiFocusContext =
  | { kind: 'message'; messageId: string }
  | { kind: 'draft'; messageId: string }
  | { kind: 'attachment'; messageId: string; attachmentId: string }
  | { kind: 'none' }
```

So there are **four** kinds: **`message`**, **`draft`**, **`attachment`**, **`none`**.

### 1.3 How each kind is set (the switching rules)

**Source:** `useMemo` **346–355** in `HybridSearch.tsx`.

| Condition | Resulting `uiFocusContext` |
|-----------|----------------------------|
| No `selectedMessageId` | `{ kind: 'none' }` |
| `activeView === 'beap-inbox'` **and** `inboxSubFocus.kind === 'draft'` **and** `inboxSubFocus.messageId === selectedMessageId` | `{ kind: 'draft', messageId }` |
| `activeView === 'beap-inbox'` **and** `inboxSubFocus.kind === 'attachment'` **and** same `messageId` **and** `selectedAttachmentId` set | `{ kind: 'attachment', messageId, attachmentId }` |
| Otherwise (including when `subFocus` is `'none'`) | `{ kind: 'message', messageId }` |

**Important:** **`draftRefineConnected`** from **`useDraftRefineStore`** is **not** part of this `useMemo**`. Refine connection does **not** change `uiFocusContext` by itself.

### 1.4 Where `inboxSubFocus` comes from

**HybridSearch.tsx** **343:**

```ts
const inboxSubFocus = useEmailInboxStore((s) => (activeView === 'beap-inbox' ? s.subFocus : SUBFOCUS_NONE))
```

If the user is **not** on **`beap-inbox`**, sub-focus is forced to **`{ kind: 'none' }`** (**15**), so the inbox draft/attachment branches never apply.

### 1.5 What sets `subFocus` to “draft” vs “message” (store level)

**Type `SubFocus`:** `useEmailInboxStore.ts` **151–154**

```ts
export type SubFocus =
  | { kind: 'none' }
  | { kind: 'attachment'; messageId: string; attachmentId: string }
  | { kind: 'draft'; messageId: string }
```

- **`{ kind: 'draft', messageId }`** is set when **`setEditingDraftForMessageId(messageId)`** runs **without** clearing (**626–641**): it sets **`subFocus: { kind: 'draft', messageId: nextId }`** (**636**).
- **`{ kind: 'none' }`** (so the UI falls back to **“message”** context) when **`setEditingDraftForMessageId(null)`** runs (**628–631**), or when selecting a message resets sub-focus (**821**), etc.

**In `InboxDetailAiPanel`**, draft/capsule textareas call **`setEditingDraftForMessageId(messageId)`** on **focus** and **`setEditingDraftForMessageId(null)`** on **blur** (e.g. capsule **1081–1085**, **1127–1131**; depackaged draft **1298–1304**).

So the **“Draft” badge** tracks **“textarea thinks you’re editing the draft”** (focus-driven), **not** “refine store is connected.”

---

## 2. HybridSearch: what controls the context badge?

### 2.1 Not a prop — derived state

The badge is controlled by **`uiFocusContext`** (**346–355**) plus **`selectedMessageId`**, **`selectedHandshakeId`**, etc.

### 2.2 Scope strip when a message is selected (no handshake)

**Block:** **670–739** (approx.). When **`selectedMessageId`** is set:

1. If **`uiFocusContext.kind === 'draft'`** → green pill: **“✏️ Draft”** + subject snippet + **×** (**675–694**).
2. Else if **`uiFocusContext.kind === 'attachment'`** → **“📎 Attachment”** (**695–715**).
3. Else → **“📨 Message”** (**717–737**).

So **“Message”** is the **default** for a selected inbox message whenever the user is **not** in draft sub-focus and **not** in attachment sub-focus — even if **`useDraftRefineStore.connected === true`**.

### 2.3 Inline icon beside the input (👉 / ✏️)

**816–825:** For **`selectedMessageId && !selectedHandshakeId`**, the leading icon uses **`uiFocusContext.kind`**:

- **`draft`** → **✏️**, green tint (**820**), title “Chat scoped to draft”.
- Else **👉**, purple, title “Chat scoped to message” or attachment.

Again: **no** branch on **`draftRefineConnected`**.

### 2.4 Separate: refine mode on the bar container

**741–744:** `data-draft-refine="true"` when **`draftRefineConnected && draftRefineMessageId === selectedMessageId`** — this is for styling/DOM only; it does **not** replace the “Message” text in the chip.

### 2.5 Placeholder text (does use refine store)

**831–836:** If **`draftRefineConnected && draftRefineMessageId === selectedMessageId`**, placeholder is **“Modify draft — …”**. So the user **can** see draft-refine **placeholder** while the **chip** still says **“Message”** if **`uiFocusContext.kind !== 'draft'`**.

---

## 3. Depackaged email: when draft is “connected” vs what the badge shows

### 3.1 Does the badge switch from “Message” to “Draft” when refine connects?

**Only if** `uiFocusContext.kind === 'draft'`, i.e. **`subFocus`** is draft for that message — typically **while the draft textarea is focused** (because **`setEditingDraftForMessageId`** was called on focus).

**`useDraftRefineStore.connect`** (**useDraftRefineStore.ts** **44–53**) does **not** update **`subFocus`**.

### 3.2 If the user clicks the chat bar to type

1. Textarea **blur** → **`setEditingDraftForMessageId(null)`** → **`subFocus` → `none`** → **`uiFocusContext` → `{ kind: 'message' }`** → chip shows **“📨 Message”**.
2. Often **mousedown** on the chat bar also triggers **click-outside** on the draft row → **`draftRefineDisconnect()`** (**EmailInboxView.tsx** **430–440**), which clears refine mode entirely.

So in practice the badge flips away from **“Draft”** as soon as focus leaves the textarea — **even when** the product goal is “stay in draft refinement.”

### 3.3 Visual difference: “chat about message” vs “refine this draft”

| Signal | “About this message” (generic) | “Refining draft” (intended) |
|--------|--------------------------------|-----------------------------|
| **Scope chip** | **📨 Message** when `uiFocusContext.kind === 'message'` | **✏️ Draft** only when `uiFocusContext.kind === 'draft'` |
| **Refine store** | `connected` false | `connected` true after `connect()` |
| **Placeholder** | “Ask a question about this BEAP message…” (**836**) | “Modify draft — …” (**832–833**) when `draftRefineConnected` matches |

So there **is** a partial visual difference (**placeholder**, **`data-draft-refine`**, green chip **if** subFocus is draft), but **the chip can still read “Message”** while refine is active — **inconsistent UX**.

### 3.4 Capsule fields (pBEAP / qBEAP)

Same **`setEditingDraftForMessageId`** on **focus** / **blur** (**1081–1085**, **1127–1131**). Selecting a capsule field sets draft sub-focus **only while focused**. Clicking the chat bar blurs the field → **“Message”** chip — which is **wrong for “draft refinement”** if the refine session were still connected (often it disconnects via mousedown-outside anyway).

---

## 4. Summary: context switching mechanism

```text
useEmailInboxStore.subFocus
        │
        ▼ (only if activeView === 'beap-inbox')
HybridSearch uiFocusContext useMemo (lines 346–355)
        │
        ├── kind === 'draft'   → badge "✏️ Draft"  (requires subFocus draft)
        ├── kind === 'attachment' → "📎 Attachment"
        └── kind === 'message' → badge "📨 Message"   ← default when subFocus is none

useDraftRefineStore.connected  ──►  NOT used for uiFocusContext
        │
        ├── setMode('chat'), placeholder, chatQuery branch (isDraftRefine), data-draft-refine
        └── Does NOT drive the Message vs Draft chip text
```

**Conclusion:** **“Message” vs “Draft”** in the bar is **inbox sub-focus** (focus/blur on draft UI), not **draft refine connection**. To align the badge with draft refinement, **`uiFocusContext`** (or the badge branch) would need to incorporate **`draftRefineConnected`** (and message id match) — **that wiring does not exist today** in the `useMemo` at **346–355**.

---

## 5. File / line index

| Item | Location |
|------|----------|
| `UiFocusContext` type | `HybridSearch.tsx` **8–12** |
| `uiFocusContext` derivation | `HybridSearch.tsx` **346–355** |
| `inboxSubFocus` selector | `HybridSearch.tsx` **343** |
| Badge: Draft / Attachment / Message | `HybridSearch.tsx` **675–737** |
| Leading 👉 / ✏️ | `HybridSearch.tsx` **816–825** |
| `data-draft-refine` | `HybridSearch.tsx` **741–744** |
| Placeholder when refine connected | `HybridSearch.tsx` **831–836** |
| `SubFocus` type | `useEmailInboxStore.ts` **151–154** |
| `setEditingDraftForMessageId` → `subFocus` | `useEmailInboxStore.ts` **626–641** |
| `useDraftRefineStore` (no `subFocus`) | `useDraftRefineStore.ts` **36–78** |

---

*Section 1C — Message vs Draft context in the chat bar. Related: `native-beap-draft-refinement-1b-chat-bar-connection.md` (refine connect/disconnect mechanics).*

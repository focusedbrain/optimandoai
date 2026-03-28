# SECTION 2 — Trace the **“AI capsule draft”** Button

**Scope:** Native BEAP capsule UI in `InboxDetailAiPanel` (`EmailInboxView.tsx`), IPC `inbox:aiDraftReply`, preload bridge.

---

## 1. What the button does when clicked

### 1.1 UI wiring

| Item | Location |
|------|----------|
| **Label** | **“AI capsule draft”** (or **“Generating…”** while loading) |
| **File** | `apps/electron-vite-project/src/components/EmailInboxView.tsx` |
| **Lines** | **1228–1235** (inside `isNativeBeap` capsule draft actions) |

**`onClick` handler:**

```1228:1235:apps/electron-vite-project/src/components/EmailInboxView.tsx
                          <button
                            type="button"
                            className="capsule-draft-clear"
                            onClick={() => void handleDraftReply()}
                            disabled={draftLoading}
                          >
                            {draftLoading ? 'Generating…' : 'AI capsule draft'}
                          </button>
```

So the button **only** invokes **`handleDraftReply()`** — no `console.log`, no other handler.

### 1.2 Handler implementation

**Function:** **`handleDraftReply`** — **562–595**.

| Step | Behavior |
|------|----------|
| **Early exit** | If **`window.emailInbox?.aiDraftReply`** is missing → **`return`** immediately (**563**) — **no user-visible error**, **no log** in this branch. |
| **Loading** | **`setDraftLoading(true)`**, clears **`draft`**, clears **`draftError`**, clears **attachments** (**564–567**). |
| **IPC** | **`await window.emailInbox.aiDraftReply(messageId)`** (**569**). |
| **Bridge** | Preload: **`aiDraftReply: (id: string) => ipcRenderer.invoke('inbox:aiDraftReply', id)`** — `electron/preload.ts` **823**. |
| **Main** | **`ipcMain.handle('inbox:aiDraftReply', …)`** — `electron/main/email/ipc.ts` **3303+**. |

**Conclusion:** The button **does** call **`inbox:aiDraftReply`** (via **`window.emailInbox.aiDraftReply`**). It does **not** use a different IPC for this action. If the bridge is absent, it **does nothing** beyond returning early.

---

## 2. Expected result and how fields are populated

### 2.1 Branching in `handleDraftReply` (renderer)

After **`const res = await window.emailInbox.aiDraftReply(messageId)`** and **`const data = res.data`**:

```569:588:apps/electron-vite-project/src/components/EmailInboxView.tsx
      const res = await window.emailInbox.aiDraftReply(messageId)
      const data = res.data
      const native = data?.isNativeBeap && data.capsuleDraft
      if (res.ok && native) {
        setCapsulePublicText(data.capsuleDraft!.publicText)
        setCapsuleEncryptedText(data.capsuleDraft!.encryptedText)
        setDraftError(!!data.error)
        setVisibleSections((prev) => {
          if (prev.has('draft')) return prev
          const next = new Set(prev)
          next.add('draft')
          return next
        })
      } else if (res.ok && data?.draft) {
        setDraft(data.draft)
        setEditedDraft(data.draft)
        setDraftError(!!data.error)
      } else {
        setDraftError(true)
      }
```

| Condition | What gets updated |
|-----------|-------------------|
| **`res.ok && data?.isNativeBeap && data.capsuleDraft`** | **`setCapsulePublicText`**, **`setCapsuleEncryptedText`** from **`capsuleDraft.publicText`** / **`.encryptedText`** (**572–574**). This is the path for **Native BEAP capsule** UI. |
| **`res.ok && data?.draft`** (and not the native branch above) | **`setDraft`**, **`setEditedDraft`** — **single-field email draft** (**582–585**). **Not** the capsule textareas. |
| Otherwise | **`setDraftError(true)`** (**587**). |

So **yes**, the Native BEAP path **explicitly checks** **`capsuleDraft`** (via **`native = data?.isNativeBeap && data.capsuleDraft`**) and **populates** **`capsulePublicText`** and **`capsuleEncryptedText`**.

### 2.2 What the main process returns for Native BEAP

**Classification** — `ipc.ts` **3332–3333**:

```ts
const isNativeBeap =
  row.source_type === 'direct_beap' || (!!row.handshake_id && row.source_type !== 'email_plain')
```

When **`isNativeBeap`** is true, the handler builds **`capsuleDraft`** with **`publicText`** and **`encryptedText`**, and returns (**3398–3405**):

```3398:3405:apps/electron-vite-project/electron/main/email/ipc.ts
        return {
          ok: true,
          data: {
            draft: draftFallback,
            capsuleDraft,
            isNativeBeap: true as const,
          },
        }
```

So the renderer’s check **`data?.isNativeBeap && data.capsuleDraft`** matches this payload.

---

## 3. End-to-end chain (button → fields)

```text
User clicks "AI capsule draft"
  → onClick: handleDraftReply()  [EmailInboxView.tsx 1231]
  → window.emailInbox.aiDraftReply(messageId)  [569]
  → preload invoke('inbox:aiDraftReply', id)  [preload.ts 823]
  → ipcMain 'inbox:aiDraftReply'  [ipc.ts 3303]
      → DB load row by messageId
      → isNativeBeap ? LLM JSON (publicMessage / encryptedMessage) → capsuleDraft : plain email draft
  → res.ok && data.isNativeBeap && data.capsuleDraft
      → setCapsulePublicText / setCapsuleEncryptedText  [572–574]
  → finally: setDraftLoading(false); draftRef.scrollIntoView  [591–594]
```

---

## 4. Gaps where “no responses are drafted” can appear

### 4.1 Bridge missing

**563:** **`if (!window.emailInbox?.aiDraftReply) return`** — **silent failure**; capsule fields unchanged.

### 4.2 IPC says not native, but UI is Native BEAP

If the DB row does **not** satisfy **`isNativeBeap`** (e.g. unexpected **`source_type`** / **`handshake_id`**), main follows the **plain email** branch and returns **`{ ok: true, data: { draft } }`** **without** **`isNativeBeap`** / **`capsuleDraft`**.

Then the renderer uses **`else if (res.ok && data?.draft)`** and sets **`setDraft` / `setEditedDraft`** only. The **capsule** panel reads **`capsulePublicText` / `capsuleEncryptedText`**, so those **stay empty** — looks like **“nothing drafted”** in the capsule fields even though **`draft`** state might hold a string (not shown in the Native BEAP textarea UI).

### 4.3 Ollama unavailable (before native branch)

**3327–3329:** Returns **`{ ok: true, data: { draft: 'Error: LLM not available…', error: true } }`** — **no** **`isNativeBeap`**, **no** **`capsuleDraft`**.

Renderer falls through to **`setDraft` / `setEditedDraft`** with the error string — again **not** mapped into **capsule** fields for Native BEAP view.

### 4.4 `res.ok` false or thrown error

**587–590:** **`setDraftError(true)`** — user should see draft error UI where wired; capsule text may remain empty.

### 4.5 Empty JSON / parse edge cases

Main still builds **`capsuleDraft`** with **`publicText`/`encryptedText`** possibly empty strings if JSON parse yields nothing (**3376–3380**) — fields populate but can look blank.

---

## 5. Relation to auto-fetch (not the button)

A separate **`useEffect`** (**619–639**) calls **`handleDraftReply()`** once when **Native BEAP**, **`needsReply`**, draft section visible, and both capsule strings still empty — same IPC, same population logic. The **“AI capsule draft”** button is the **manual** trigger of the same **`handleDraftReply`** path.

---

## 6. Short answers (checklist)

| Question | Answer |
|----------|--------|
| **onClick** | **`() => void handleDraftReply()`** — **1231** |
| **IPC** | **`inbox:aiDraftReply`** via **`aiDraftReply`** — **yes** |
| **Other IPC / no-op** | **No** other handler for this button; **yes** no-op if **`aiDraftReply`** missing (**563**) |
| **`capsuleDraft` checked?** | **Yes** — **`data?.isNativeBeap && data.capsuleDraft`** (**571**) |
| **Populate capsule fields?** | **Yes** — **`setCapsulePublicText`**, **`setCapsuleEncryptedText`** (**572–574**) |
| **Generic draft only?** | Only on **fallback branch** **`res.ok && data?.draft`** (**582–585**) — used for **non-native** email reply UI, not capsule fields |

---

*Section 2 — “AI capsule draft” button trace. Related: `native-beap-draft-refinement-architecture-analysis.md` (§2 `handleDraftReply`).*

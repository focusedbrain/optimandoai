# Handshake Deletion Analysis

**Scope:** Code trace only — what happens on revoke vs permanent delete, which related rows are removed, extension behavior, and whether a new handshake can reuse stale `peer_*` material.

---

## Delete mechanism

| Path | Function | Location | Type | What happens |
|------|----------|----------|------|----------------|
| **Revoke (user “revoke”)** | `revokeHandshake` | `handshake/revocation.ts` **25–116** | **Soft:** state change | **`updateHandshakeRecord`** sets **`state = REVOKED`**, `revoked_at`, `revocation_source`. **Row stays** in `handshakes` (including **`local_*` / `peer_*` BEAP columns** until a later hard delete). Deletes **embeddings** and **`context_blocks`** for that `handshake_id`; **audit** insert. Best-effort **enqueue revoke capsule** to peer. |
| **Permanent delete** | `deleteHandshakeRecord` | `handshake/db.ts` **1785–1806** | **Hard DELETE** | **`DELETE FROM handshakes WHERE handshake_id = ?`** after related deletes (see below). **Allowed only** if state is **`REVOKED`**, **`EXPIRED`**, or **`PENDING_ACCEPT` with `local_role === 'initiator'`** (cancel pending request). Active/accepted handshakes **cannot** be hard-deleted via this API without revoke first. |
| **IPC** | `handshake.initiateRevocation` | `ipc.ts` **465–476** | Calls `revokeHandshake` | |
| **IPC** | `handshake.delete` | `ipc.ts` **585–589** | Calls `deleteHandshakeRecord` | |

**Revoke is not a DELETE** — it is an **UPDATE** plus derived data removal (`context_blocks`, embeddings). **Crypto material remains** in the `handshakes` row until **`deleteHandshakeRecord`** runs.

---

## Related tables — what `deleteHandshakeRecord` cleans

From `db.ts` **1795–1802** (in order):

1. `deleteEmbeddingsByHandshake` — removes rows in **`context_embeddings`** tied to blocks for this handshake (subquery on **`context_blocks`**).
2. `deleteBlocksByHandshake` — **`DELETE FROM context_blocks WHERE handshake_id = ?`**
3. **`DELETE FROM context_store WHERE handshake_id = ?`**
4. **`DELETE FROM seen_capsule_hashes WHERE handshake_id = ?`**
5. **`DELETE FROM outbound_capsule_queue WHERE handshake_id = ?`**
6. **`DELETE FROM audit_log WHERE handshake_id = ?`**
7. **`DELETE FROM handshakes WHERE handshake_id = ?`**

---

## Orphaned references after delete

| Table | References `handshake_id` | Cleaned on `deleteHandshakeRecord`? |
|-------|---------------------------|--------------------------------------|
| `handshakes` | PK | **Yes** (row removed) |
| `context_blocks` | yes | **Yes** |
| `context_embeddings` | indirect via blocks | **Yes** (before blocks deleted) |
| `context_store` | yes | **Yes** |
| `seen_capsule_hashes` | yes | **Yes** |
| `outbound_capsule_queue` | yes | **Yes** |
| `audit_log` | optional | **Yes** (rows for that id deleted) |
| `p2p_pending_beap` | yes | **No** — not referenced in `deleteHandshakeRecord` |
| `inbox_messages` | yes | **No** |
| `capsule_blocks` | yes | **No** — deletion exists only in **`reindexHandshakeCapsule`** (`capsuleBlockIndexer.ts` **170**), not in `deleteHandshakeRecord` |
| `sent_beap_outbox` | yes | **No** — inserts in `main.ts`; no delete-by-handshake in `deleteHandshakeRecord` |

**On revoke only:** `context_blocks` are deleted; **`handshakes` row remains**; tables above that are not tied to revoke cleanup may still reference the same `handshake_id` unless other code paths remove them.

**Risk:** After **hard delete**, **foreign references** in `p2p_pending_beap`, `inbox_messages`, `capsule_blocks`, and `sent_beap_outbox` can **orphan** (pointing at a non-existent `handshake_id`), depending on SQLite FK enforcement (many columns are plain `TEXT`, not enforced FKs).

---

## New handshake with same counterparty

- **Initiate:** `handshake_id = \`hs-${randomUUID()}\`` (`ipc.ts` **726**). Always a **new** id → **`insertHandshakeRecord`** via `persistInitiatorHandshakeRecord` — **no UPDATE** of an old **`REVOKED`** row.
- **No** `findByEmail` / upsert in the initiate path for reusing a row (grep-style: initiate flow does not load an existing handshake by counterparty email to reuse keys).
- **Import initiate:** If **`getHandshakeRecord(db, handshake_id)`** already exists → **reject** (`ipc.ts` **524–527**: “Handshake already exists”).
- **Could a new handshake “pick up” old `peer_*`?** Only if the **UI** or **client** mistakenly **selects the wrong handshake record** (e.g. stale list). The **server-side initiate path** does **not** copy `peer_*` from a prior row; new row gets new **`ensureKeyAgreementKeys`** material for **local** keys and **`peer_*`** from counterparty only after capsules are processed.

**Two rows same email:** Possible (**initiator** pending + **revoked** history, or multiple relationship ids). **`handshake.list`** returns multiple records; UI should distinguish by **`handshake_id`**, not email alone.

---

## Extension storage and notifications

- **`deleteHandshake`** (`handshakeRpc.ts` **241–248**): RPC **`handshake.delete`**; on success calls **`removeLocalMlkemSecret(handshakeId)`** — removes **`chrome.storage.local`** key **`beap_mlkem768_secret_v1::<handshakeId>`** (`mlkemHandshakeStorage.ts` **27–30**).
- **No** broad “clear all extension handshake cache” beyond that ML-KEM secret key; **Electron DB** remains source of truth for list/peers via RPC.
- **`useHandshakes`** reads **`handshake.list`** over RPC only — **no** long-lived Zustand handshake store for the list (**`useHandshakes.ts`** comment: backend SQLite is SSOT).
- **HandshakeManagementPanel** after delete: **`refresh()`** to refetch list (**305–308**).

**Stale `peer_*` from a “deleted” handshake:** Unlikely if the list refreshes and **`selectedRecipient`** is built from **current** `normalizeRecord` / **`handshake_id`**. Risk rises if another component caches by **email** without **`handshake_id`**.

---

## Inline / draft composer selection

- Draft flow uses **`selectedRecipient`** (see **`useBeapDraftActions.ts`**) with **`SelectedRecipient`** tied to handshake material; management UI resolves selection by **`handshake_id`** (**`HandshakeManagementPanel`** **107**: `handshakes.find((h) => h.handshake_id === selectedHandshakeId)`).
- **Recommendation:** Ensure any composer that builds qBEAP uses **`handshake_id` + fresh list** after delete/revoke — **not** email alone when multiple handshakes exist.

---

## “Nuclear” cleanup

There is **no** single exported **“wipe all handshake data for one id”** that also deletes **`p2p_pending_beap`**, **`inbox_messages`**, **`capsule_blocks`**, and **`sent_beap_outbox`**. **`deleteHandshakeRecord`** is the closest **central** routine and is **incomplete** for those tables.

Example **manual** SQL (conceptual — run only with backups and correct DB attachment):

```sql
-- Not all are FK-safe; verify schema and FKs before use.
DELETE FROM p2p_pending_beap WHERE handshake_id = ?;
DELETE FROM inbox_messages WHERE handshake_id = ?;
DELETE FROM capsule_blocks WHERE handshake_id = ?;
DELETE FROM sent_beap_outbox WHERE handshake_id = ?;
-- Then call existing delete path or repeat deletes from deleteHandshakeRecord + DELETE handshakes
```

**Full reset** (`DELETE FROM handshakes;` etc.) would require **many** tables and is **not** shipped as one function in this trace.

---

## Root cause (if applicable)

**Incomplete deletion** can leave **orphan** rows (`p2p_pending_beap`, `inbox`, **`capsule_blocks`**, **outbox**) pointing at a deleted **`handshake_id`**, causing **confusing UI**, **dangling P2P payloads**, or **wrong inbox association**. That is **distinct** from **peer/local key mismatch**, which is usually **key generation / storage** logic — but **stale extension selection by email** could still send using **wrong `peer_*`** if two handshakes share a counterparty.

---

## Fix (recommended directions)

1. **Extend `deleteHandshakeRecord`** (or a single **`deleteHandshakeCascade`**) to **`DELETE FROM p2p_pending_beap`, `inbox_messages`, `capsule_blocks`, `sent_beap_outbox`** where **`handshake_id = ?`**, in a transaction, before **`DELETE FROM handshakes`**.
2. **Revoke path:** Decide whether to **strip** or **retain** BEAP columns on **`REVOKED`** rows; if retaining for audit, document; if **hard delete** is the only wipe, ensure users run **delete after revoke**.
3. **Extension:** Optionally **broadcast** handshake-deleted event to **invalidate** any in-memory selection keyed only by email.
4. **UI:** Always key composer **`selectedRecipient`** on **`handshake_id`** from latest **`handshake.list`**.

---

## Reference lines

- `deleteHandshakeRecord`: `apps/electron-vite-project/electron/main/handshake/db.ts` **1785–1806**
- `revokeHandshake`: `apps/electron-vite-project/electron/main/handshake/revocation.ts` **25–116**
- `handshake.delete` / `initiateRevocation`: `apps/electron-vite-project/electron/main/handshake/ipc.ts` **465–476**, **585–589**
- Extension `deleteHandshake` + `removeLocalMlkemSecret`: `apps/extension-chromium/src/handshake/handshakeRpc.ts` **241–248**

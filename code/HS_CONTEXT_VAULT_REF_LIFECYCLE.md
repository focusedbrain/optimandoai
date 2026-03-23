# __og_vault_service_ref Lifecycle

**Purpose:** Document when the vault service ref is set and cleared, and why `resolveHsProfilesForHandshake` may be undefined at accept time.

---

## 1. Assignments (SET)

| Location | When | Code |
|----------|------|------|
| `vault/rpc.ts` — `setupEmbeddingServiceRef` | Called on vault unlock | `;(globalThis as any).__og_vault_service_ref = { getDb, getEmbeddingService, getStatus, resolveHsProfilesForHandshake }` |
| `main.ts` — WebSocket `vault.unlock` | Via `handleVaultRPC` → `setupEmbeddingServiceRef(vaultService)` | Line 155 in rpc.ts |
| `main.ts` — HTTP `POST /api/vault/unlock` | After `vaultService.unlock()` | Line 6032: `setupEmbeddingServiceRef(vaultService, db)` |
| `main.ts` — IPC `vault:unlockForHandshake` | When vault already unlocked | Line 3056: `setupEmbeddingServiceRef(vaultService, db)` |
| `main.ts` — IPC `vault:unlockWithPassword` | After `vaultService.unlock()` | Line 3075: `setupEmbeddingServiceRef(vaultService, db)` |

---

## 2. Clears (NULL)

| Location | When | Code |
|----------|------|------|
| `vault/rpc.ts` — `clearEmbeddingServiceRef` | Called on vault lock | `;(globalThis as any).__og_vault_service_ref = null` |
| `main.ts` — WebSocket `vault.lock` | Via `handleVaultRPC` → `clearEmbeddingServiceRef()` | Line 160 in rpc.ts |
| `main.ts` — HTTP `POST /api/vault/lock` | **Before** `vaultService.lock()` | Line 6049: `clearEmbeddingServiceRef()` |

---

## 3. Timing Issue: Auto-Lock

**VaultService** has an **autolock timer** (`vault/service.ts` lines 1703–1717):

- Default: 30 minutes of inactivity
- On timeout: calls `this.lock()` internally
- **Question:** Does internal `lock()` call `clearEmbeddingServiceRef`?

**Answer:** No. Internal `vaultService.lock()` does NOT call `clearEmbeddingServiceRef`. The ref is only cleared when:

1. `vault.lock` RPC is invoked (WebSocket)
2. `POST /api/vault/lock` HTTP is invoked

So when the user **explicitly** locks via the UI, the ref is cleared. When **autolock** fires, `vaultService.lock()` runs but `clearEmbeddingServiceRef()` is **not** called — the ref stays set!

**Exception:** The extension/Electron UI may send `vault.lock` or `POST /api/vault/lock` when autolock triggers. Need to trace: when autolock fires, does the UI call the lock endpoint?

---

## 4. IPC vs Ref: Different Paths

| Operation | Path | Uses |
|-----------|------|------|
| `vault:listHsContextProfiles` | main.ts IPC handler | `vaultService.listHsProfiles()` **direct** |
| `resolveProfileIdsToContextBlocks` | handshake/ipc.ts | `__og_vault_service_ref.resolveHsProfilesForHandshake` **or** `vaultService` fallback |

**Key insight:** `listHsContextProfiles` uses `vaultService` directly (imported in main.ts). It never uses the ref. So listing works even when the ref is null.

`resolveProfileIdsToContextBlocks` originally used only the ref. It runs in main process (handshake IPC). If the ref is null, it returns `[]` — hence "profiles not attached."

**Fix applied:** Fallback to `vaultService.resolveHsProfilesForHandshake` when ref is undefined. Both use the same `vaultService` instance; the ref is just a proxy.

---

## 5. When Can the Ref Be Undefined?

1. **User never unlocked** — Ref never set; accept would fail earlier (vault locked).
2. **User locked** — Explicit lock clears ref. If user unlocks, opens accept dialog, then locks (or another tab locks), ref is cleared.
3. **Electron startup** — Ref is null until first unlock.
4. **Multiple processes** — Unlikely; Electron is single process.
5. **WebSocket vs HTTP** — Extension uses HTTP; WebSocket uses same ref. Both go through main process.

---

## 6. Recommendation

- **Diagnostic logging** added to `resolveProfileIdsToContextBlocks` — logs ref state, profile count, document counts.
- **Fallback** to `vaultService` direct when ref is undefined — bypasses ref lifecycle.
- **Test:** After rebuild, unlock vault, select profile with parsed PDF, click Accept. Check logs for:
  - `[HS Profile Resolution] resolveProfileIdsToContextBlocks:` — refDefined, resolveFnDefined
  - `[HS Profile Resolution] Resolved:` — profileCount, docs with hasExtractedText
  - If `refDefined: false` and fallback used: confirms ref lifecycle issue
  - If `refDefined: true` but `profileCount: 0`: issue is in query/resolution

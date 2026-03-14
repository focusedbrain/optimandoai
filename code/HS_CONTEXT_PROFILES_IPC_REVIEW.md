# HS Context Profiles IPC Fix — Runtime Review

## 1. Return type mismatch

**IPC handler returns:** `{ profiles }` (object with `profiles` array)  
**Shim reads:** `res?.profiles` → `Array.isArray(res?.profiles) ? res.profiles : []`  
**HandshakeContextProfilePicker expects:** `HsContextProfileSummary[]` (from `setProfiles(result)`)

**vaultService.listHsProfiles() return type:**

```1236:1241:apps/electron-vite-project/electron/main/vault/service.ts
  listHsProfiles(tier: VaultTier, includeArchived = false) {
    this.ensureUnlocked()
    this.updateActivity()
    return listProfiles(this.db!, tier, includeArchived)
  }
```

`listProfiles()` returns `HsContextProfileSummary[]`:

```157:174:apps/electron-vite-project/electron/main/vault/hsContextProfileService.ts
export function listProfiles(
  db: any,
  tier: VaultTier,
  includeArchived = false,
): HsContextProfileSummary[] {
  requireHsContextAccess(tier, 'read')

  const rows: HsContextProfileRow[] = db
    .prepare(
      `SELECT p.*, (SELECT count(*) FROM hs_context_profile_documents d WHERE d.profile_id = p.id) as doc_count
       FROM hs_context_profiles p
       WHERE p.archived = ?
       ORDER BY p.updated_at DESC`,
    )
    .all(includeArchived ? 1 : 0)

  return rows.map((row: any) => rowToSummary(row, row.doc_count ?? 0))
}
```

**Verdict:** No mismatch. The handler returns `{ profiles }` where `profiles` is `HsContextProfileSummary[]`. The shim extracts `res.profiles` and returns it. The picker receives the array directly. No pagination; it's a plain array.

---

## 2. Synchronous vs async

**vaultService.listHsProfiles()** is **synchronous** — it returns `HsContextProfileSummary[]` directly, not a Promise.

```1236:1240:apps/electron-vite-project/electron/main/vault/service.ts
  listHsProfiles(tier: VaultTier, includeArchived = false) {
    this.ensureUnlocked()
    this.updateActivity()
    return listProfiles(this.db!, tier, includeArchived)
  }
```

`listProfiles()` is sync (no `async`, no `await`). The IPC handler does not need `await` for this call. The handler is `async` for `getEffectiveTier()` and `import()`, which are async.

**Verdict:** No change needed. Sync return is fine.

---

## 3. Tier dependency

**getEffectiveTier()** can return `UNKNOWN_TIER` ('unknown') when:
- Session is missing (`!session.accessToken || !session.userInfo`)
- AND `lastKnownGoodTier` is null

```161:170:apps/electron-vite-project/electron/main.ts
async function resolveRequestTier(): Promise<Tier> {
  const session = await ensureSession()
  if (!session.accessToken || !session.userInfo) {
    if (lastKnownGoodTier != null) {
      console.log('[ENTITLEMENT] resolveRequestTier: session missing — returning lastKnownGoodTier:', lastKnownGoodTier)
      return lastKnownGoodTier
    }
    console.log('[ENTITLEMENT] resolveRequestTier: session missing, no lastKnownGoodTier — returning unknown')
    return UNKNOWN_TIER
  }
  // ...
}
```

**When tier is 'unknown':** `canAccessRecordType('unknown', 'handshake_context', 'read')` returns `false`:

```146:152:packages/shared/src/vault/vaultCapabilities.ts
export function canAccessRecordType(
  tier: VaultTier,
  recordType: VaultRecordType,
  action: VaultAction = 'read',
): boolean {
  // unknown = no access (most restrictive)
  if (tier === 'unknown') return false
```

So `requireHsContextAccess(tier, 'read')` in `listProfiles()` throws:

```98:103:apps/electron-vite-project/electron/main/vault/hsContextProfileService.ts
function requireHsContextAccess(tier: VaultTier, action: 'read' | 'write' | 'share' = 'write'): void {
  if (!canAccessRecordType(tier, 'handshake_context', action)) {
    throw new Error(`HS Context Profiles require Publisher or Enterprise tier (current: ${tier})`)
  }
}
```

**Verdict:** Tier is never null/undefined — it is always a string (e.g. `'unknown'`, `'publisher'`). When tier is `'unknown'`, `listProfiles` throws before touching the DB. The IPC handler catches and re-throws. The picker shows `err.message`. No null/undefined tier path.

---

## 4. Preload channel name

**Preload exposes:** `handshakeView` via `contextBridge.exposeInMainWorld('handshakeView', { ... })`

**Shim accesses:** `(window as any).handshakeView?.listHsContextProfiles`

**Other shims (handshakeRpc.ts):**

```17:19:apps/electron-vite-project/src/shims/handshakeRpc.ts
  if (window.handshakeView?.listHandshakes) {
    return window.handshakeView.listHandshakes({ state: _filter })
  }
```

```37:39:apps/electron-vite-project/src/shims/handshakeRpc.ts
  if (window.handshakeView?.initiateHandshake) {
    return window.handshakeView.initiateHandshake(
```

**Verdict:** Correct. The namespace is `handshakeView`, and `listHsContextProfiles` is on it. No `electronAPI` or other namespace.

---

## 5. Profile field mapping

**DB row (HsContextProfileRow):**
- `tags: string` (JSON string)
- `archived: number` (0/1)
- `created_at`, `updated_at`: numbers

**rowToSummary()** maps to `HsContextProfileSummary`:

```107:118:apps/electron-vite-project/electron/main/vault/hsContextProfileService.ts
function rowToSummary(row: HsContextProfileRow, documentCount = 0): HsContextProfileSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    scope: row.scope,
    tags: JSON.parse(row.tags || '[]'),
    updated_at: row.updated_at,
    created_at: row.created_at,
    document_count: documentCount,
  }
}
```

**HandshakeContextProfilePicker uses:**
- `profile.id`, `profile.name`, `profile.scope`, `profile.document_count`, `profile.description`

**Verdict:** Mapping is correct. `tags` is parsed from JSON string to `string[]`. `document_count` comes from the subquery. `scope` is already a string. `description` uses `?? undefined` (null → undefined). The picker does not use `tags`, `created_at`, or `updated_at`, but they are present and serializable.

---

## 6. Context bridge serialization

**Profile shape:** `{ id, name, description?, scope, tags, updated_at, created_at, document_count }`

- `id`, `name`, `scope`: strings
- `description`: string | undefined (undefined may be omitted in IPC)
- `tags`: string[]
- `updated_at`, `created_at`, `document_count`: numbers

**Structured clone (IPC):** Supports strings, numbers, booleans, null, arrays, plain objects. Does not support functions. `undefined` as a property value is typically omitted, not cloned.

**Verdict:** All profile fields are serializable. No functions, no `Date` objects (timestamps are numbers). If `description` is undefined, it may be omitted; `profile.description` will be undefined on the renderer side, which is fine.

---

## Summary

| Check | Status | Notes |
|-------|--------|-------|
| Return type | OK | `{ profiles }` with `HsContextProfileSummary[]`; shim extracts correctly |
| Sync vs async | OK | `listHsProfiles` is sync; no `await` needed |
| Tier dependency | OK | Tier is always a string; `'unknown'` causes throw before DB access |
| Preload channel | OK | `handshakeView.listHsContextProfiles` matches other shims |
| Field mapping | OK | `rowToSummary` maps DB row to expected shape |
| Serialization | OK | All fields are serializable |

No code changes required based on this review.

# PR B-5/11 — Extension Stage-5 Merge Migration + BEAP Attachment Hash Binding

## Summary

Three deliverables:

1. **Extension Stage-5 merge path sealed**: `mergeExtensionDepackaged.ts` migrated from raw
   `db.prepare().run()` to `prepareSealedUpdate` + `runSealedTransaction`.  The function is now
   async and routes through `validatorOrchestrator.validate()` before every write.

2. **BEAP attachment hash binding (Att-2)**: A new `content_type: 'beap_message'` discriminator
   is added to `contentValidator.ts`.  Every new merge write must include `attachments_canonical`
   (with SHA-256 hashes of attachment bytes).  The seal binds the entire canonical content
   including these hashes; post-write tampering with attachment rows is detectable.

3. **cloneToSandbox round-trip verified**: All four wire points of the Host→Sandbox clone path
   are confirmed present and wired.  See Step B/G verification log.

## Step A — `mergeExtensionDepackaged` investigation results

| Item | Finding |
|------|---------|
| Entry point | `POST /api/inbox/merge-depackaged` HTTP handler in `main.ts` (localhost; Chromium extension is the caller) |
| Write type | **UPDATE only** — shell `inbox_messages` row must already exist (created by email ingestion or P2P inline path before Stage-5) |
| Old write primitives | `db.prepare('UPDATE inbox_messages ...').run(...)` — raw, no seal |
| `inbox_attachments` writes | Raw INSERT / UPDATE statements inside the same function |
| Attachment bytes | Extension sends `base64`-encoded bytes; SHA-256 is computed inline |
| `depackaged_json` source | JSON string from extension Stage-5 (capsule plaintext: subject, body, transport_plaintext, attachments, automation, optional session_import_artefact) |
| Shell row creation | Created earlier by `messageRouter.ts` (IMAP BEAP) or `processBeapPackageInline` (P2P). This file is NOT the only writer globally — it provides final canonical content after depackage. |

**Decision A — update pattern chosen**: The shell-row-exists pattern requires a sealed UPDATE (not
INSERT).  `runSealedTransaction(db, sealedUpdate, bindArgs, sealParams, childWrites)` provides
the atomic sealed UPDATE + child attachment writes.

## Step B — cloneToSandbox round-trip classification

| Wire point | Location | Status |
|------------|----------|--------|
| 1. Button → IPC invocation | `src/lib/beapInboxCloneToSandbox.ts` `beapInboxCloneToSandboxApi` → `window.beapInbox.cloneBeapToSandbox(...)` → `ipcRenderer.invoke('inbox:cloneBeapToSandbox', ...)` | ✅ Wired |
| 2. IPC handler → prepare | `email/ipc.ts` `handleBeapInboxCloneToSandbox` calls `prepareBeapInboxSandboxClone(db, session, srcId, ...)` → returns `{ success: true, prepare: prep }` | ✅ Wired |
| 3. Renderer → P2P delivery | `cloneBeapInboxToSandbox(prep)` builds `BeapPackageConfig` with `inboxResponsePathMetadata.sandbox_clone: true`; calls `executeDeliveryAction` for P2P send | ✅ Wired |
| 4. Sandbox P2P receive | `processBeapPackageInline` (B-4) handles delivered qBEAP package on sandbox P2P paths | ✅ Wired |

**Verdict**: The round-trip works end-to-end for normal (non-quarantine) clones.

The `sandbox_clone_quarantine` path (quarantined messages cloned to sandbox) is a separate
mechanism using `processSandboxQuarantineReceive` (B-4) and is not part of this verification.

No fix required — no missing wire found.

## Decisions

### Decision A — Shell-row update pattern (confirmed)

`mergeExtensionDepackaged` performs a **sealed UPDATE** (not INSERT).  The shell row is created
by an earlier ingestion path.  `runSealedTransaction` provides atomic sealed UPDATE + child
attachment writes in one SQLite transaction.

### Decision B — `attachments_canonical` for BEAP (new `beap_message` content type)

Added `content_type: 'beap_message'` as a new discriminator in `validateDecryptedBeapContent`.
When present:
- `attachments_canonical` is **required** (even as `[]` for messages with no attachments).
- Each entry must have a non-empty `attachment_id`.
- `content_sha256` must be a non-empty string when present.
- `session_import_artefact` is validated (same path as the default BEAP branch).

Old-shape BEAP rows (sealed without `content_type`) hit the existing default branch — they are
accepted without `attachments_canonical` for backward compatibility (Decision 1.5 — no legacy
migration).

The distinction between old-shape reads and new writes is structural: new writes produced by
`mergeExtensionDepackaged` always include `content_type: 'beap_message'` in the canonical JSON.
The validator branch enforces `attachments_canonical` only for this discriminator.  No `is_new_write`
flag is needed — the content type itself carries the distinction.  Stop-and-report condition 2 does
not apply.

### Decision C — Attachment hashes from extension bytes (confirmed)

The extension sends `base64`-encoded attachment bytes in `MergeDepackagedAttachmentInput.base64`.
`mergeExtensionDepackaged` decodes these and calls `createHash('sha256').update(buf).digest('hex')`
before the validator call.  Hashes are computed once and bound into the canonical JSON.

Attachments without bytes (`base64` absent or empty) get `content_sha256: null` in
`attachments_canonical` — a metadata-only entry.  The validator accepts `null` for `content_sha256`.

### Decision D — cloneToSandbox (all wired; no fix required)

All four wire points confirmed.  See Step B table.

## Deliverables

1. **`packages/ingestion-core/src/contentValidator.ts`** — `validateBeapMessageContent` function +
   `content_type: 'beap_message'` dispatch branch.

2. **`electron/main/email/mergeExtensionDepackaged.ts`** — Full async rewrite:
   - `async mergeExtensionDepackaged(db, input, session?)` (was synchronous)
   - Builds `attachments_canonical` from attachment bytes (SHA-256)
   - Builds canonical content: `{ ...parsedDepackaged, content_type: 'beap_message', attachments_canonical }`
   - Calls `validatorOrchestrator.validate()` with `source_type: 'extension'`
   - On success: `runSealedTransaction(db, sealedUpdate, bindArgs, sealParams, childAttachmentWrites)`
   - On validation failure: attempts quarantine write (if paired sandbox available), then falls
     back to unsealed failure update of shell row

3. **`electron/main.ts`** — `await mergeExtensionDepackaged(db, req.body, ssoSession ?? null)` in
   the `POST /api/inbox/merge-depackaged` handler.

4. **`electron/main/email/__tests__/b5ExtensionMerge.test.ts`** — New test suite (Steps E, F, G).

5. **`electron/main/email/__tests__/mergeExtensionDepackaged.validation.test.ts`** — Updated for
   async function; mocks added for validator orchestrator and sealed-storage primitives.

6. **No cloneToSandbox fix required** — round-trip confirmed complete.

## Stop-and-report conditions encountered

| Condition | Triggered? | Resolution |
|-----------|-----------|------------|
| 1. Stage-5 progressive merging | No | Single sealed validation per merge call |
| 2. Validator cannot distinguish new-write vs old-shape read | No | `content_type: 'beap_message'` discriminator carries the distinction |
| 3. Extension path claims attachment exists without host holding bytes | No | Extension sends `base64` bytes; SHA-256 computable before validator call |
| 4. cloneToSandbox round-trip broken (substantial fix) | No | All four wire points confirmed |
| 5. `mergeExtensionDepackaged.ts` writes to unexpected tables | No | Only `inbox_messages` and `inbox_attachments` |

## Verification log

```
rg "INSERT INTO inbox|UPDATE inbox" electron/main/email/mergeExtensionDepackaged.ts
→ Only sealed-write call sites: runSealedTransaction (UPDATE), prepareSealedInsert (quarantine INSERT).
  Raw db.prepare() calls limited to: inbox_attachments child writes inside sealed transaction
  closure (covered by parent seal's Att-2 hash binding), MERGE_FAILURE_UPDATE_SQL (only on
  validation failure, no seal written), and SELECT queries.

rg "content_type.*beap_message|beap_message.*content_type" packages/ingestion-core/src/
→ contentValidator.ts: dispatch branch + validateBeapMessageContent function (added B-5).

rg "attachments_canonical" electron/main/email/mergeExtensionDepackaged.ts
→ attachments_canonical built in processedAtts loop, merged into canonicalContent,
  included in canonicalJson sent to validator.

TypeScript: no new errors introduced by B-5 (pre-existing errors in main.ts and
decryptQBeapPackage.ts are unrelated to B-5 changes).
```

## What was NOT verified

1. **Old-shape BEAP rows in test database**: The backward compatibility path (old BEAP content
   without `content_type: 'beap_message'` accepted by the default branch) is theoretically
   correct but was not tested with rows actually sealed before B-5.  The code path is exercised
   by test §E.7 with synthetic content.

2. **cloneToSandbox with real paired sandbox**: The round-trip was verified structurally (module
   imports, function signatures, wire-point code paths) but was not end-to-end tested with a
   live paired sandbox device.  Test §G.2 uses a minimal DB fixture without a real sandbox
   handshake.

3. **Performance of SHA-256 on large attachments**: Hashes are computed synchronously before the
   validator call.  For large attachments (e.g. 50 MB), this may add noticeable latency to the
   merge HTTP response.  Not blocking — noted for future investigation.

4. **`mergeExtensionDepackaged` quarantine path with a real sandbox**: The quarantine-on-failure
   branch (`encryptForQuarantine` + `writeQuarantineBlob` + `quarantine_messages` INSERT) was
   verified by code review and mock-based tests but was not tested with a real sandbox public key.
   The test for §F.4 uses `findPairedSandboxHandshake → null` (no sandbox), exercising the fallback
   unsealed update path.

# WRC Registry API Contract — Delta v1.1
## Embedded catalog delegation; historical delegations read endpoint

Status: ADDITIVE delta to `WRC-Registry-API-Contract_v1.0.md` (author drop, commit `20794bff`, preserved byte-exact). The contract version is now **v1.1**. Nothing in v1.0 is withdrawn or reordered; the amendments below add one required field, one endpoint, and one clarification. Author ruling of 2026-08-09.

Scope discipline unchanged: this remains an INTERFACE REFERENCE for the Phase-3 runtime client, never a build order for the WRC service. Live-instance acceptance items stay `integration-pending`.

**Origin.** Phase 3 reported a gap: §3.6 defined the DelegationRecord and §4.1 defined a write endpoint for it, but §4.2 exposed no path from which a client could obtain a publisher's delegation chain. A client that had never seen a delegation therefore could not verify a CatalogHead signed by a delegated catalog key.

**Resolution.** The head is fetched on every resolve anyway. Embedding the delegation in the head makes verification deterministic, offline-capable once the head is in hand, and immune to selective blocking of a side-fetch. The new read endpoint serves audit and rotation review, never verification.

---

## A. §3.1 CatalogHead — new field `delegation`

CatalogHead gains:

```json
"delegation": { …DelegationRecord per §3.6… } | null
```

Rules:

1. `delegation` is REQUIRED non-null whenever `kid` is not the publisher's root key. It is `null` when the head is root-signed.
2. Head verification MUST complete from the DNS-pinned root key plus the embedded record ALONE. **No fetch may occur in the verification path.**
3. A delegated head is valid only if
   `valid_from_epoch <= epoch` AND (`revoked_from_epoch` is null OR `revoked_from_epoch > epoch`).
4. `kid` ≠ root with a missing or invalid embedded record ⇒ verification failure. There is **no fallback fetch, ever**.

The embedded record is itself verified against the DNS-pinned root key, exactly as a separately obtained record would be. Its `authority` remains `catalog-signing-only`, so a delegation may not authorize a further delegation: a record whose `root_kid` names anything other than the publisher's root key is invalid, which makes sub-delegation unrepresentable rather than merely discouraged.

## B. §4.2 — new endpoint `GET /v1/publishers/{part}/delegations`

Public, unauthenticated, read-only, in keeping with §1.7.

Returns the full append-only historical list of DelegationRecords for the publisher part, oldest first. Rotation is a new record with a later `valid_from_epoch`; records are never deleted or modified, so the list is the rotation history.

This endpoint exists for **audit and rotation verification**. It is NEVER required for, and MUST NOT be consulted during, head verification.

## C. §5 obligation 3 — restated

Obligation 3 now reads: verify the full envelope before use — publisher signature (root, **or delegated via the record embedded in the CatalogHead and verified against the DNS-pinned root**), ingest countersignature, inclusion proof against the verified CatalogHead, EVP size budget.

---

## Client obligations added by this delta

- Treat a delegated head with no embedded record as a verification failure with its own typed reason, distinct from a bad signature.
- Never reach for the network while verifying a head.
- Reject a delegation whose `root_kid` is not the DNS-pinned root, whose signature does not verify under that root, or whose epoch window excludes the head's epoch — each with its own typed reason.

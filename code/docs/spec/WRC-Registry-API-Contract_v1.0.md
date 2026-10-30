# WRC Registry API Contract v1.0
## Workflow Ready Cloud (WRC)™ — Publisher Registry, Catalog, and Audit Service

Status: Implementation contract (English, normative for the service and the Phase-3 runtime client). Implements: Annex XVI (publisher-part assignment, resolution, anti-enumeration, status model) · Annex XIV §XIV.5.5 (Catalog Head, proof chain, dual assurance, delegation) · Annex XVII (WR Entry™ objects, Entry Value Package, attested handover, public auditability, suspension discipline).

Service identity: this service is the first component of the **Workflow Ready Cloud (WRC)™**. Placement per D2 default: **STANDALONE service** (author-overridable until Phase-3 start; protocol identical either way; dev vs. prod deployment is configuration only).

Consumers: (a) the registry/WRC service implementation (separate deliverable, like wr-connect.php); (b) the runtime Phase-3 resolution client in Electron main. The runtime agent codes against this contract CONTRACT-FIRST: the WRC service itself is a later, separate deliverable — until it exists, the Phase-3 client is built and tested against local fixtures/mocks behind an isolated transport interface (same pattern as the envelope-transport swap). This document is an interface reference for the runtime agent, never a build order for the service.

---

## 1. Non-Negotiable Principles

1. **Registry answer = CLAIM, never sole trust anchor** (P3). The client independently dual-channel-validates every resolved domain (DNS `_wr` record + `/.well-known/wr/manifest`); the manifest's declared publisher part is a cross-check after resolution (mismatch = alarm, §XVI.11.3 pattern), never a resolution source.
2. **Append-only assignment ledger.** Publisher parts are assigned randomly/non-sequentially, collision-checked, recorded insert-only. No DELETE path exists in schema or code (P11 structurally). No reassignment, ever.
3. **Anti-enumeration** (§XVI.16). No listing endpoints for parts or publishers. Resolution is per-part, rate-limited, with uniform 404 timing for unknown vs. suspended-hidden identifiers where the status model requires it.
4. **Carrier, never trust anchor.** All served content is content-addressed and signature-carried; the transport (TLS) authenticates nothing about publisher material.
5. **Dual assurance from day one.** Every published object carries the publisher signature (authorization) AND the WRC ingest countersignature (hygiene). The dev instance countersigns with a dev key — per the staging rule (Annex XVII §XVII.8), assurance is never staged out.
6. **Atomicity per epoch; rejection, never modification** (Annex XVII §XVII.3.3). A publication becomes resolvable as a whole or not at all; the service rejects with a stated reason and never alters, re-signs, or partially applies a package.
7. **Read side is public and passive.** All GET endpoints are unauthenticated, read-only, non-personalizing, non-tracking.

## 2. Cryptographic Conventions

- Signatures: Ed25519 over canonical JSON (recursively sorted keys, no whitespace — byte-identical to `@wr/crypto` / wr-connect `wrc_canonical_json`). Signature fields hold base64url (unpadded) detached signatures; the signed payload is the object minus its `sig` field.
- Hashes: `sha256:<base64url>` over canonical JSON of the object (or raw bytes for binary artifacts).
- Merkle: leaves = `sha256` of every object in the epoch's publication state (entries, EVPs, scope manifests, artifact metadata records), sorted lexicographically by hash; parent = `sha256(left || right)`; odd node promotes. `inclusion_proof` = array of `{ "pos": "left"|"right", "hash": "sha256:…" }` from leaf to `catalog_root`.
- Keys: publisher **root key** (cold; anchored via DNS `_wr` fingerprint) and delegated **Catalog Signing Key** (day-to-day). Catalog-signed objects carry `kid`; the delegation record (§3.6) proves the chain root→catalog key.

## 3. Object Schemas (canonical JSON)

### 3.1 CatalogHead
```json
{ "type": "wrc/catalog-head", "publisher_part": "PPPPPP", "domain": "example.com",
  "catalog_root": "sha256:…", "epoch": 7, "issued_at": 1754650000,
  "freshness_window_s": 86400, "kid": "cat-a1b2c3d4", "sig": "…" }
```
Client obligations: enforce strictly monotonic `epoch` per publisher (persisted; lower epoch ⇒ reject, anti-rollback); past `issued_at + freshness_window_s` the head is stale ⇒ cached material remains usable visibly stale, NO new authorization-bearing admissions.

### 3.2 Entry (WR Entry™, Annex XVII §XVII.3.2)
```json
{ "type": "wrc/entry", "entry_id": "LLLLL", "publisher_part": "PPPPPP",
  "display": { "name": "…", "icon": "sha256:…|null", "value_statement": "…" },
  "codes": [ { "canonical": "PPPPPPLLLLLC", "channels": ["code_scan","manual_entry","assisted_email","assisted_discovery"] } ],
  "scopes": [ "sha256:…" ], "evp_ref": "sha256:…", "template_ref": "sha256:…|null",
  "status": "published|suspended|retired", "epoch": 7, "kid": "…", "sig": "…" }
```
`entry_id` doubles as the WR code local part where the entry is code-addressable (D3: a longer local part is its own entry). `draft` never appears on the wire — drafts do not exist toward the WRC (single authoring instance).

### 3.3 EntryValuePackage (EVP, Annex XVII §XVII.4)
```json
{ "type": "wrc/evp", "publisher_part": "PPPPPP", "entry_id": "LLLLL",
  "self_description": "…", "value_statement": "…",
  "scope_directory": [ { "scope": "sha256:…", "name": "…", "desc": "…", "size_hint_b": 12345, "prefetch": "none|recommended" } ],
  "preparation_view": "sha256:…|null", "next_steps": [ "…" ],
  "audit_links": true, "epoch": 7, "kid": "…", "sig": "…" }
```
**Size budget (v0, platform-wide): canonical bytes ≤ 65 536 (64 KiB).** Over-budget EVPs are REJECTED AT INGEST (never truncated). The client verifies the budget again before render and treats violation as a verification failure.

### 3.4 DualAssuranceEnvelope (every object GET)
```json
{ "object": { …canonical object… }, "hash": "sha256:…",
  "publisher_sig_valid_kid": "…", "ingest_countersig": { "kid": "wrc-ingest-1", "at": 1754650100, "sig": "…" },
  "epoch": 7, "inclusion_proof": [ { "pos": "left", "hash": "sha256:…" } ],
  "suspension": null | { "since": 1754660000, "reason_code": "…", "reversible": true } }
```
The countersignature signs `hash || epoch`. `suspension` present ⇒ the object is NOT resolvable for admission; audit view still serves it with the suspension marker (visible, auditable, reversible — never a content change).

### 3.5 PublicationPackage (attested handover)
```json
{ "type": "wrc/publication", "publisher_part": "PPPPPP",
  "objects": [ { …entry/evp/scope-manifest/artifact-record… } ],
  "catalog_head": { …CatalogHead epoch n+1… }, "sig_channel": "attested publisher channel" }
```

### 3.6 DelegationRecord
```json
{ "type": "wrc/catalog-delegation", "publisher_part": "PPPPPP",
  "delegate_kid": "cat-…", "delegate_pub": "…", "authority": "catalog-signing-only",
  "valid_from_epoch": 1, "revoked_from_epoch": null, "root_kid": "root-…", "sig": "…(root key)" }
```

## 4. Endpoints (prefix `/v1`)

### 4.1 Registration & assignment (write side, attested)
- `POST /v1/publishers/register` — body `{ "domain": "example.com" }` → dual-channel verification challenge (reuses the WP0–WP2 verifier: DNS `_wr` + well-known manifest must already validate). On success: random non-sequential collision-checked 6-char part, insert-only ledger row `{part, domain, root_fingerprint, assigned_at, generation}`. Response: `{ "publisher_part": "PPPPPP", "generation": 1 }`. Errors: `409 domain_already_assigned` (returns nothing about the existing part), `422 dual_channel_failed{step}`.
- `POST /v1/publishers/{part}/delegation` — submit/rotate a DelegationRecord (root-signed; verified against the registered root fingerprint). Rotation = new record with `valid_from_epoch`; old records never deleted.
- `POST /v1/publishers/{part}/publish` — PublicationPackage over the attested publisher channel (v0 dev: HTTPS + a registration-issued bearer bound to the part, replaced by the pBEAP/mgmt channel later; the channel authorizes the WRITE only — content trust rides on signatures). Behavior: verify every object signature against root-or-delegated key, verify EVP budgets, verify catalog_head (epoch exactly current+1, root over the exact object set), run ingest scan hooks → countersign all-or-nothing → atomically switch the publisher's resolvable state to epoch n+1. Responses: `202 { "epoch": 8 }` or `409/422 rejected { "reason_code", "detail" }`. NEVER partial, NEVER modified.

### 4.2 Resolution & catalog (read side, public)
- `GET /v1/resolve/{part}` → `{ "domain", "status": "active|inactive|revoked|superseded|compromised", "generation", "catalog_head": {…}, "root_fingerprint" }` (D4 status model authoritative here; cache demotion per §XVI.15.3). Rate-limited; unknown part ⇒ uniform `404 unknown_identifier` → client Capture-Error path.
- `GET /v1/publishers/{part}/catalog/head` → current CatalogHead.
- `GET /v1/publishers/{part}/entries/{entry_id}` → DualAssuranceEnvelope(Entry). Suspended ⇒ envelope with `suspension` set and `410` semantics for admission purposes.
- `GET /v1/objects/{sha256}` → DualAssuranceEnvelope for any published object (EVP, scope manifest, artifact record). Content addressing guarantees byte-identity with whatever any client loaded.

### 4.3 Public audit (Annex XVII §XVII.6)
- `GET /v1/audit/{sha256}` — unauthenticated, read-only; `Accept: application/json` → the DualAssuranceEnvelope; `Accept: text/html` → a passive human-readable page showing hash, publisher signature status, ingest countersignature, epoch, inclusion proof, and any suspension record. No scripts, no personalization, no tracking. This URL is the client's per-item "verify in repository" link.

## 5. Runtime-Client Obligations (binds Phase 3+)

1. Treat every resolve/catalog answer as a claim; independently dual-channel-validate the domain before any trust conclusion; cross-check the manifest-declared part (mismatch ⇒ alarm, never silent).
2. Persist `last_seen_epoch` per publisher; reject lower epochs (anti-rollback); enforce freshness (stale head ⇒ visibly stale cache, no new admissions).
3. Verify the full envelope before use: publisher signature (root or valid delegation), ingest countersignature, inclusion proof against the verified CatalogHead, EVP size budget.
4. **EVP-first-render:** after capture and verification, the first render shows ONLY the signed `value_statement` and `self_description` from the verified EVP — never any claim carried by the email/carrier. Offer surfaces expose the audit link.
5. Surface suspension as its own visible state (distinct copy + audit link), never as a silent absence.

## 6. Out of Scope for v0 (explicitly)

Fraud Watchdog™ model integration (the ingest-scan hook interface exists; dev instances may flag manually — the *hook*, countersignature, and suspension mechanics are NOT optional); Merkle multi-proof batching; HTML audit-view styling beyond passive minimalism; the pBEAP publish channel (interface isolated for the swap, as with the mgmt envelope transport).

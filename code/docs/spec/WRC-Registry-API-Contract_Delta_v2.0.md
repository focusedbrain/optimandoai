# WRC Registry API Contract — Delta v2.0
## Namespace Directory, per-class entry lookup, disclosure tiers, closed signed objects

Status: **Ratified by the Author on 2026-09-26**, by accepting every recommended default: Q20–Q27 = A (§11). The contract version is now **v2.0**. Agent-drafted under Q17 = A (`docs/analysis/resync-2026-09-addendum.md` §B2; `docs/analysis/iteration-01-2026-09-25.md`, "Next"). Every item tagged OPEN below is decided by the recommended option of its question; the question text stays as the rationale. From here on the file is frozen, as v1.1 was; later changes come as a new delta.

Base: `WRC-Registry-API-Contract_v1.0.md` (`20794bff`) plus `WRC-Registry-API-Contract_Delta_v1.1.md` (`d8ac21b1`). Normative authority: Annex XVI v1.95, `docs/spec/Annex_XVI_WR_Code_v1.95.pdf`, sha256 `064aad6d8f28a0b1b7688c516ca3c4d8ba486bf723a5483d8c119d44f875829f` (re-verified for this draft).

Client reference: `integration/consolidated-current` at `54ea1181`. Paths are relative to `code/`; `wrc/` means `apps/electron-vite-project/electron/main/wrc/`.

Scope discipline is unchanged from v1.0: this is an interface reference for the runtime client and for every publisher-side component (WRC service, `wr-connect.php`, relay). It is not a build order for any of them.

---

## 0. How to read this draft

Every item carries one tag:

- **AS-BUILT**: the client already requires this. The service must match it; the client does not change.
- **CHANGE**: the annex or a ruling requires something the client does not do yet. The client work is listed in §9.
- **OPEN**: needed an Author decision. Each one points to a question in §11; all were ratified as recommended.

**Why a major version.** A v1.x service breaks against this client in four places: the `{entry_id}` path segment no longer means "local part" (§4.2); entry and object reads gain an account tier (§6), where v1.0 §1.7 made every GET public; the closed-object rule (§2.6) makes a head without an explicit `delegation` field fail verification; and `codes[].canonical` carries the class prefix (§4.3). Everything else is additive.

**On field names.** The annex drafting convention (v1.95 p. 1) makes "field lengths, delimiters, … hash functions, and example data structures … embodiment or profile choices unless the text identifies a functional dependency". Appendix A.4 field schemas are therefore reference-profile content, not wire names. This draft keeps the client's wire names and maps them to A.4 (§5.4, §7.2). Where A.4 or §XVI.6.4 requires *content* that has no wire field, the gap is listed.

---

## 1. Summary

| # | Area | Change | Tag |
|---|---|---|---|
| 2 | Crypto conventions | exact countersignature message, Merkle sibling semantics, key and fingerprint encodings; closed vs open signed objects | AS-BUILT |
| 3.1 | DNS `_wr` TXT | one record carrying `v=wr1; part=<PART>; root=<hex64>` | AS-BUILT |
| 3.2 | `/.well-known/wr/manifest` | schema defined (v1.0 names the URL only) | AS-BUILT |
| 4.1 | `GET /v1/resolve/{part}` | field meanings clarified; `generation` is the assignment generation | AS-BUILT |
| 4.2 | `GET /v1/publishers/{part}/entries/{key}` | the path segment is a per-class lookup key; the served `entry_id` is the repository id | AS-BUILT, plus one CHANGE (P binding) and OPEN Q21 |
| 4.3 | Entry object | new optional `designation`; `codes[].canonical` is prefixed | AS-BUILT |
| 4.4 | EVP | signature, suspension and binding written down (addendum O-A1) | AS-BUILT |
| 5 | Namespace Directory | new `GET /v1/directory/{part}`; dual-signed closed record | AS-BUILT, with CHANGEs and OPEN Q22–Q26 |
| 6 | Disclosure tiers | public tier vs account tier for entries, objects and audit | CHANGE, OPEN Q20 |
| 7 | Relay and capsule legs | object shapes recorded; wire endpoints left open for S7 | OPEN Q27 |
| 8 | Write side | unchanged; directory registration stays out of band | — |

---

## 2. Cryptographic conventions (clarifies v1.0 §2) — AS-BUILT

**2.1 Canonical JSON.** Recursively sorted keys, no insignificant whitespace, integers only. The client uses `canonicalJsonString` from `@repo/ingestion-core` (`wrc/wrcCrypto.ts:40-43`).

**2.2 Signature input.** Ed25519 over the canonical JSON of the object with its signature field(s) *removed* (not blanked). There is no domain-separation prefix; the WR Handshake `WRH1|…` tag must not be used (`wrc/wrcCrypto.ts:10-15,102-116`).

**2.3 Ingest countersignature.** v1.0 says it "signs `hash || epoch`". Exactly: the UTF-8 bytes of the `sha256:…` hash string immediately followed by the decimal epoch, with no separator and no canonical object (`wrc/wrcCrypto.ts:124-126`).

**2.4 Merkle inclusion.** Parents hash the *raw 32-byte digests*, not the `sha256:` strings. In each proof step, `pos` names the side the **sibling** sits on (`left` → `sha256(sibling ‖ acc)`) (`wrc/wrcCrypto.ts:135-150`).

**2.5 Keys and fingerprints.** Public keys are raw 32-byte keys (Ed25519 for signing, X25519 for sealing), base64url unpadded. Signatures are 64 bytes, base64url unpadded. A fingerprint is the lowercase hex sha256 of the raw public key bytes (`wrc/dualChannel.ts:70-73`, `wrc/namespaceDirectory.ts:501-508`).

**2.6 Closed and open signed objects.** The client verifies some signatures over the object it *decoded*, not over the bytes it received. For those objects an unknown field, a missing optional field, or different casing changes the canonical bytes, so the signature fails. They are **closed**: the signer must sign exactly the listed fields, with nullable fields present as `null`.

| Object | Verified over | Rule for the signer |
|---|---|---|
| CatalogHead `wrc/catalog-head` | decoded head (`wrc/wrcVerify.ts:164`, input from `wrc/wrcContract.ts:74-105`) | exactly 10 fields; `delegation` present (`null` for a root-signed head); `domain` lowercase |
| DelegationRecord `wrc/catalog-delegation` (embedded in the head) | decoded record (`wrc/wrcVerify.ts:111`) | exactly 9 fields; `revoked_from_epoch` present |
| Publisher manifest `wr/manifest` | decoded manifest (`wrc/dualChannel.ts:124`, input from `wrc/wrcContract.ts:578-592`) | exactly 6 fields; `domain` lowercase |
| Directory record `wrc/directory-record` | decoded record (`wrc/namespaceDirectory.ts:272-298`) | exactly the 18 fields of §5.2; each `keys[]` item exactly `{kid, pub, generation}` |
| Operator rollover `wrc/operator-rollover` | no wire channel yet. `decodeOperatorRollover` exists but is not called (`wrc/namespaceDirectory.ts:164`), so the fold verifies the object as passed (`:197-208`) | treat as closed: exactly 6 fields. C6 decodes before folding |
| Entry, EVP, any object inside a DualAssuranceEnvelope | the object as received (`wrc/wrcVerify.ts:212-240`) | **open**: extra fields are hashed and signed, and the client ignores them |

Consequence: a new field on a closed object is a breaking change for every deployed client. A new field on an entry or EVP is not.

---

## 3. Publisher-served channels

### 3.1 DNS `_wr.<domain>` TXT — AS-BUILT

The publisher publishes **one** TXT record at `_wr.<domain>`:

```
v=wr1; part=<PUBLISHER_PART>; root=<lowercase hex sha256 of the raw root public key>
```

Two independent parsers read it. The dual channel takes the first `v=wr1` record carrying `root=` (`wrc/dualChannel.ts:81-89`). The directory proof takes the first `v=wr1` record carrying `part=` and compares it case-insensitively (`wrc/namespaceDirectory.ts:329-337`). Neither merges records. A publisher MUST NOT publish more than one `v=wr1` record: with two `part=` records, only the first counts (`wrc/__tests__/directoryGate2.e2e.test.ts:239`). The fixture generator emits exactly this combined form (`wrc/__tests__/wrcFixtures.ts:662`).

Publisher tooling: the repo's `wr-connect.php` v0.1.5 emits `v=WR1; pid=…; rk=…; mr=…; proto=…`, which fails both parsers (resync T2). It must emit this record.

### 3.2 `https://<domain>/.well-known/wr/manifest` — AS-BUILT

v1.0 §1.1 names the URL but defines no schema. The client requires this closed object, self-signed by the root key (`wrc/wrcContract.ts:569-592`):

```json
{ "type": "wr/manifest", "domain": "example.com", "publisher_part": "WR7X4K",
  "root_kid": "root-a1", "root_pub": "<base64url raw Ed25519>", "sig": "…" }
```

Verification order (`wrc/dualChannel.ts:105-172`): DNS record → manifest fetch → manifest self-signature → manifest key fingerprint equals the DNS `root=` → manifest `domain` equals the validated domain → manifest `publisher_part` equals the resolved part (mismatch is an alarm) → registry `root_fingerprint` equals the channels' key (checked last, never trusted first). Size cap 32 KiB.

---

## 4. Registry read side

### 4.1 `GET /v1/resolve/{part}` — AS-BUILT

The response is unsigned; it is a claim (`wrc/wrcContract.ts:529-561`):

```json
{ "domain": "example.com", "status": "active", "generation": 1,
  "catalog_head": { …closed CatalogHead, §2.6… }, "root_fingerprint": "<hex64>" }
```

- There is no top-level `publisher_part`. The client requires `catalog_head.publisher_part` to equal the requested part (`wrc/resolutionClient.ts:148-150`).
- `generation` is the assignment-ledger generation of v1.0 §4.1. It is not the directory record generation (§5.2). The client stores it and makes no decision on it.
- `status` uses the lowercase D4 enum: `active | inactive | revoked | superseded | compromised`. §5.8 covers which status the client trusts.
- Unknown part: uniform `404`. Size cap 16 KiB.

### 4.2 `GET /v1/publishers/{part}/entries/{key}` — AS-BUILT, with one CHANGE and OPEN Q21

v1.0 §3.2 defines `{entry_id}` as the WR code local part. Since Run 3 the client sends a **lookup key that depends on the reference class** (`wrc/gatePipelineAdapter.ts:122-126`), and the served entry's `entry_id` is the publisher's **repository id** for that entry:

| Reference class | Path segment `{key}` | Served `entry.entry_id` | Binding the client checks |
|---|---|---|---|
| P | local block (5 symbols) | MUST equal the local block | **none today — CHANGE C1 (§9)** |
| C | responder Publisher Identifier (block 3) | repository id of the C umbrella | `designation` names the ordered pair: initiator = block 2, counterparty = block 3; a reversed pair is refused (`wrc/entryDesignator.ts:165-203`) |
| I, SP, SI, SC, SE | combination block (6 symbols) | repository id of the expanded entry constituent | `designation.cls` = the class, `designation.combination` = block 3, a receiving party is present, and the parent follows the class rule (`wrc/entryDesignator.ts:206-312`) |
| parent of an S* entry | `designation.parent.entry_id` when the resolver names it; the responder id for a C parent | the parent's repository id | the parent is `published` and not suspended (`wrc/gatePipelineAdapter.ts:305-333`) |

The EVP must name the entry's repository id: `evp.entry_id === entry.entry_id` (`wrc/resolutionClient.ts:270-275`).

**Uniqueness (OPEN Q21).** The lookup key carries no class. A 6-symbol combination code, a 6-symbol responder id and a repository id can therefore collide under one publisher. The client fails closed on a collision, because the class and designation checks refuse the wrong entry. The effect is a denial, not a substitution. Recommended rule: lookup keys are unique per publisher across all key families, and the service rejects at ingest any publication that would make two entries answer the same key (v1.0 principle 6: rejection, never modification).

Suspended or retired entries are served as data (`allowSuspended`), and Gate 3 refuses them with the precise reason (`wrc/gatePipelineAdapter.ts:238-245`). Unknown key: uniform `404`. Size cap 128 KiB.

### 4.3 Entry object additions — AS-BUILT

**`designation`** (optional; inside the publisher-signed entry, so it is covered by the publisher signature, the ingest countersignature and Merkle inclusion). When present it must be well-formed, or the whole entry refuses to decode (`wrc/wrcContract.ts:127-169,305-312`):

```json
"designation": {
  "cls": "SC",
  "combination": "M8W2R4",
  "initiator_part": null,
  "counterparty_part": null,
  "receiving_party": { "kind": "publisher", "id": "XYZ789" },
  "parent": { "cls": "C", "publisher_part": "ABC123", "counterparty_part": "XYZ789", "entry_id": null },
  "session": null,
  "pairing": null
}
```

Per-class rules the client enforces (`wrc/entryDesignator.ts:135-313`):

- **P:** optional. If present, `cls` is `P` and there is no `parent`.
- **C:** required. `cls` is `C`; `initiator_part` and `counterparty_part` are both set; no `parent`.
- **I:** required. `cls` is `I`; `combination` is set; `receiving_party` is set; no `parent`. A pairing slot adds `pairing: { "slot": true, "expected_device_class": string|null, "expires_at": int|null }`.
- **SP / SI / SC / SE:** required. `parent.cls` must be P for SP, I for SI, C for SC, and any of P, I, C, SP, SI, SC for SE. `parent.publisher_part` equals block 2. A C parent carries `counterparty_part`; other parents must not. For SC with a `publisher` receiving party, its id is the parent's counterparty.
- **SE:** `session: { "id", "not_before": int|null, "expires_at": int }` is mandatory; Gate 3 refuses an SE without one.
- `receiving_party.kind` is one of `publisher`, `principal`, `device`.

**`codes[].canonical`** carries the grammar-v2 canonical form: class prefix, alias-normalized body and check, uppercase and ungrouped, e.g. `PWR7X4K9B2M3C`, `SPWR7X4KH2N5V87` (`packages/ingestion-core/src/wrCodeGrammar.ts:158-159,248`). v1.0's prefix-less example `PPPPPPLLLLLC` is superseded; Gate 1 refuses prefix-less codes. The client decodes `codes[]` but does not use it (`wrc/wrcContract.ts:282-289`).

### 4.4 EVP — AS-BUILT (addendum observation O-A1)

An EVP carries its own `kid`/`sig`. Its envelope may carry a `suspension`, which refuses admission independently of the entry's status, because the EVP envelope is verified with the same `allowSuspended` setting as the entry (`wrc/resolutionClient.ts:256-263`). An EVP has no reference of its own; it is bound to exactly one entry by `evp_ref` hash equality and by `publisher_part` + `entry_id` equality (`wrc/resolutionClient.ts:266-275`). The 64 KiB canonical budget of v1.0 §3.3 stands.

### 4.5 Unchanged read endpoints

`GET /v1/publishers/{part}/catalog/head`, `GET /v1/publishers/{part}/delegations` (v1.1 §B) and `GET /v1/objects/{sha256}` are unchanged. The client transport exposes the first two, but no client code path calls them; head verification uses the head embedded in the resolve answer (`wrc/resolutionClient.ts:161-170`). `GET /v1/audit/{sha256}` is unchanged except for §6.

### 4.6 Transport rules the service must satisfy — AS-BUILT

From the hardened client (`wrc/httpsClient.ts:10-24`), which is the only HTTP path the WRC client uses:

- HTTPS only, TLS 1.2 or later, a publicly trusted certificate.
- No redirects: any 3xx is a failure.
- The host must resolve to a public address. Loopback, link-local and private addresses are refused at connect time, and there is no override.
- JSON bodies (`Accept: application/json`) within the caps: 16 KiB for resolve, head and directory; 128 KiB for entries, objects and delegations; 32 KiB for the manifest (`wrc/wrcTransport.ts:59-61`).

---

## 5. Namespace Directory (new, §XVI.6.4/6.5)

### 5.1 `GET /v1/directory/{part}` — AS-BUILT

Public, unauthenticated, read-only (§XVI.6.4: "Directory lookups are namespace-keyed and do not require a user identity"). The directory applies anti-enumeration controls: rate limiting and no listing. Unknown part: uniform `404`. Size cap 16 KiB. The client fetches it from the same registry base URL as every other endpoint (`wrc/wrcTransport.ts:99-100`, `wrc/wrcRuntime.ts:207-214`).

### 5.2 Directory Record — AS-BUILT (closed object)

```json
{ "type": "wrc/directory-record", "publisher_part": "WR7X4K",
  "keys": [ { "kid": "root-a1", "pub": "<base64url raw Ed25519>", "generation": 1 } ],
  "encryption_pub": "<base64url raw X25519>",
  "resolver_endpoints": [ "https://wrc.example/v1/publishers/WR7X4K" ],
  "relay_endpoints": [ "https://relay.example/v1/WR7X4K" ],
  "grammar_version": "2",
  "domains": [ "example.com" ], "display_origin": null,
  "account_holder_vetted": true,
  "status": "active", "successor_publisher_part": null,
  "generation": 3, "expires_at": 4000000000,
  "operator_kid": "dir-op-1", "operator_sig": "…",
  "publisher_kid": "root-a1", "publisher_countersig": "…" }
```

Field rules (`wrc/namespaceDirectory.ts:51-80,115-162`):

- `keys[]` is non-empty and MUST include the publisher's DNS-pinned root key. The client refuses an entry chain whose root fingerprint is not among the directory keys (`wrc/gatePipelineAdapter.ts:260-279`).
- `encryption_pub`, `display_origin` and `successor_publisher_part` are present, either a string or `null`.
- `domains[]` is non-empty; index 0 is the primary DNS-proved domain.
- `status` uses the lowercase D4 enum. `generation` is at least 1. `expires_at` is in unix seconds.
- `grammar_version`: see Q23. The fixture's `"1.95"` is the annex version, not the grammar version.

Signature layering (`wrc/namespaceDirectory.ts:26-30,272-298`):

- `operator_sig`, by the operator key named by `operator_kid`, over the canonical record minus `operator_sig` and `publisher_countersig`;
- `publisher_countersig`, by the `keys[]` entry named by `publisher_kid`, over the canonical record minus `publisher_countersig`, so it endorses the operator-signed content including `operator_sig`.

### 5.3 What the client verifies, in order — AS-BUILT

From `wrc/namespaceDirectory.ts:251-321,409-494`: decode → `publisher_part` equals the asked part → operator key known (pinned anchor plus folded rollovers) → operator signature → publisher countersignature → not expired → generation not below the durable floor → `account_holder_vetted` → raise the floor atomically → for an `active` record, the DNS `part=` proof under `domains[0]`. A non-active record is surfaced to the status handling only after it verified.

### 5.4 Mapping to Annex A.4.1 and gaps

| A.4.1 field | Wire field | Status |
|---|---|---|
| `publisher_id` | `publisher_part` | name only |
| `generation` | `generation` | same |
| `status` (ACTIVE, …) | `status` (`active`, …) | casing only |
| `grammar_version` (uint) | `grammar_version` (string) | OPEN Q23 |
| `verification_keys[]` (key, generation, valid_from, valid_to) | `keys[]` (kid, pub, generation) | no validity window: OPEN Q27 |
| `encryption_keys[]` (key, generation, valid_from, valid_to; predecessors kept) | `encryption_pub` (one key) | no history: OPEN Q27. The client never reads this field today; the Gate-6 decryption key comes from deployment configuration (`wrc/wrcIdentity.ts:103`) |
| `resolver_endpoints[]` | `resolver_endpoints[]` | decoded, never used for routing: OPEN Q26 |
| `relay_endpoints[]` | `relay_endpoints[]` | decoded, never used: S7 |
| `origins[]` | `domains[]` | name only; DNS proof per entry: CHANGE C2 |
| `display_origin` | `display_origin` | normalization and membership unchecked: CHANGE C8 (S5) |
| `connector` (script_version, code_hash) | **absent** | required by §XVI.6.4 ("containing at least"). Because the record is closed, a record carrying it fails `operator_sig_invalid` in today's client: OPEN Q22 |
| `verified_holder` (opaque attestation) | `account_holder_vetted` (boolean) | the client needs only the verdict; kept |
| `expiry` | `expires_at` | name only |
| `operator_signature`, `publisher_signature` | `operator_sig`, `publisher_countersig` (+ `operator_kid`, `publisher_kid`) | name only |
| — | `successor_publisher_part` | client addition, used to surface SUPERSEDED; kept |

### 5.5 DNS proof for every registered domain — CHANGE C2

§XVI.6.5 lets a principal act for a publisher when its SSO e-mail domain is "the publisher's DNS-verified domain or a domain that the publisher's directory record explicitly registers as its own (each such domain carrying its own DNS proof)". The service MUST publish the `_wr` record of §3.1 under **every** `domains[]` entry. The client proves only `domains[0]` (`wrc/namespaceDirectory.ts:480`) but accepts an SSO e-mail in any listed domain (`wrc/gatePipelineAdapter.ts:219-225`, `wrc/capsuleAdmission.ts:365-367`). It must prove each domain it relies on.

### 5.6 `display_origin` — CHANGE C8 (feeds S5)

§XVI.2 and A.4.1: the Displayed Responsible Domain is the registrable base domain only (no scheme, no `www.` or other subdomain, no path, port or query), lowercase, internationalized names in punycode, and it must correspond to one of `domains[]`. The client checks only that the value is a non-empty string (`wrc/namespaceDirectory.ts:134`). Before S5 renders it, the client must check the normalization and the membership, and render nothing on failure.

### 5.7 Operator key rollover — OPEN Q24

The rollover record shape is as built (`wrc/namespaceDirectory.ts:83-90`): dual-signed over the canonical record minus `sig_outgoing` and `sig_incoming`, folded from the pinned anchor, stopping at the first broken link (`:188-214`). There is no distribution channel: the runtime builds the directory client with the pinned anchor and no rollovers (`wrc/wrcRuntime.ts:207-214`), so an operator rollover today requires a runtime update.

### 5.8 Which status the client trusts — OPEN Q25

Two statuses exist: the resolve claim's (unsigned) and the directory record's (operator-signed, publisher-countersigned). Gate 2 uses the directory's (`wrc/gatePipelineAdapter.ts:178-198`). The C-responder check for SC uses the resolve claim's (`wrc/gatePipelineAdapter.ts:290-303`), although §XVI.6.5 requires the responder's namespace to pass "account-holder and DNS verification".

### 5.9 Resolver routing — OPEN Q26

Ruling 3d wants verification and resolution at the resolver of the verified namespace. Every lookup goes to one deployment-wide base URL (`WRDESK_WRC_REGISTRY_URL`, `wrc/wrcRuntime.ts:115-123`), and `resolver_endpoints` is never read.

---

## 6. Disclosure tiers (ruling 3; §XVI.4.2, §XVI.4.3, §XVI.6.3) — CHANGE, OPEN Q20

**The conflict.** v1.0 §1.7 makes every GET public, and §4.2 serves the full entry envelope to anyone. The annex and ruling 3 limit that:

- §XVI.4.2: before consent the resolver returns only what is needed to identify the namespace, validate the candidate, determine lifecycle or request state, and present an offer or status.
- §XVI.4.3: public metadata may be verified without an Orchestrator session and without a stable user identity.
- §XVI.6.3: for a PENDING C entry, "To any principal that does not chain to the responder named in the second block, the resolver returns at most a status such as NOT_FOR_YOU (§XVI.4.2), without confirming whether the entry exists or is pending."
- Ruling 3 (resync D4 row 3c): without an account, only class, publisher and domain, plus status for P and public sub-handshakes.

Annex erratum candidate: the C-class description (v1.95 pp. 14–15) says "The second block names the namespace whose repository holds it (the initiator); the third block names the responder". §XVI.6.3, and the recipient-bound sentence on p. 15 ("chaining to the second block's publisher"), use "second block" for the responder. This draft, like the client, reads the responder as block 3 (`reference.counterparty`).

Today the client fetches C entries by responder id, and I and S* entries by combination code, on the public endpoint. The served `designation` discloses the pair, the receiving party and the parent (`wrc/gatePipelineAdapter.ts:242-245`).

**Proposal.**

1. **Public tier** (no credential): `/v1/resolve/{part}`, `/v1/directory/{part}`, catalog head, delegations, and `entries/{key}` for entries the publisher declares public.
2. **Visibility on the entry:** a new signed entry field `"visibility": "public" | "account"`. It is additive, because entries are open objects (§2.6). The default is `public` for P and `account` for every other class. C and I entries are always `account`, and the service rejects at ingest a C or I entry declared public. Whether an S* entry may be declared public is Q20.
3. **Account tier:** entries with `visibility: "account"`, every object referenced only by such entries (their EVPs included), and the JSON audit body of such objects.
   - The service serves a C entry only to a caller whose SSO e-mail domain is among the DNS-verified domains of the initiator or the named responder.
   - It serves an I or S* entry only to the receiving party (the principal's e-mail, or a principal of the receiving publisher) or to a principal of the entry's own namespace.
4. **Uniform answers:**
   - No credential and no public entry under the key: `401 {"reason":"account_required"}`, identical for unknown keys.
   - A credential but no entry visible to this caller: `404 unknown_identifier`, identical for unknown, not-for-you and pending-for-someone-else.
   - Neither answer confirms existence (§XVI.6.3).
5. **Audit (v1.0 §4.3):** for an account-tier object, the public audit view shows hash, signature status, countersignature, epoch, inclusion proof and suspension, but not the object body.
6. **Credential (Q20):** recommended is an OIDC bearer access token from the product SSO, with the registry as its own audience.

---

## 7. Relay and capsule legs (Gates 5 and 6) — OPEN Q27, defined with S7

Gate 5 and Gate 6 run against local stores on the WRC security DB; the client makes no relay request over the network (resync T1 item 6). This draft records the as-built shapes as the starting point for the S7 wire contract and fixes no endpoint yet.

### 7.1 As-built objects

| Object | Where | Fields |
|---|---|---|
| `wrc/delegation-cert` | `wrc/relayRelease.ts:49-63` | publisher_part, principal_party_id, sso_email, scope[], principal_pub, expires_at, kid, sig; signed by a directory-registered publisher key |
| `wrc/release-claim` | `wrc/relayRelease.ts:66-78` | capsule_id, party_id, publisher_part\|null, request_instance_id, issued_at, principal_pub, sig; signed by the Principal Key |
| `wrc/relay-envelope` | `wrc/relayRelease.ts:96-111` | capsule_id, publisher_part, entry_key (the canonical designator key), recipient {party_id, publisher_part\|null, principal_key_fingerprint\|null}, expires_at, status (`available \| withdrawn \| terminal`), capsule |
| `wrc/pending-capsule` | `wrc/capsuleAdmission.ts:123-145` | capsule_id, request_instance_id, initiator_part, party_bindings {initiator, recipient} each {party_id, email}, scope[], nonce_i_sealed, nonce_i_hash (hex), issued_at, expires_at, delegation (by value), sig |
| nonce seal | `wrc/capsuleAdmission.ts:72-91,412` | X25519 ECDH (ephemeral to recipient) → HKDF-SHA256 (salt `wrc/seal/v1`, info = `capsule_id`) → AES-256-GCM; layout ephemeral pub (32) ‖ iv (12) ‖ tag (16) ‖ ciphertext, base64url |

### 7.2 Gaps against Annex A.4.2–A.4.5 and §XVI.6.5

- **Delegation Certificate (A.4.2):** the wire lacks `generation`, `valid_from`, `publisher_key_generation` and the optional `device_scoped_id`. `scope[]` is free text where A.4.2 has the enum `initiate | accept | revoke`. §XVI.6.5 requires verifiers to check "scope, generation, and expiry"; the client checks scope and expiry only.
- **E-mail-domain agreement at Gate 5:** §XVI.6.5 requires every verifier to check that the certificate's e-mail domain is among the publisher's DNS-verified domains. The relay chain never reads `sso_email` (`wrc/relayRelease.ts:187-273`). Gate 6 does check it (`wrc/capsuleAdmission.ts:365-371`). A relay service must.
- **Capsule (A.4.3):** A.4.3 names ordered `responder_parties[]` with one `nonce_I_enc` per responder and an `entry_reference`. The client models a single recipient and no entry reference. `capsule_id` is a client addition.
- **Acceptance Record (A.4.4):** not built (S7, Establishment Commitment).
- **Device Record (A.4.5):** travels over the pairing and the C relationship's sealed channel, not the registry. Out of scope for this contract.

### 7.3 What S7 must define

Wire operations for deposit (initiator), release against a signed claim, withdrawal and terminal status, and acceptance delivery. The Relay endpoint comes from `relay_endpoints[]` in the verified directory record (§XVI.6.4). The relay stays keyless (ruling 9): it stores and releases ciphertext plus the signed envelope and can decrypt nothing.

---

## 8. Write side

v1.0 §4.1 is unchanged. Initial directory registration is an out-of-band, operator-vetted act (§XVI.6.4), and every later record update is countersigned by the publisher. This draft defines no directory write endpoint; that belongs to the WRC service deliverable.

---

## 9. Client work this delta implies

Numbered for reference from the sections above. Items C3–C7 follow from the ratified answers to the linked questions.

| # | Change | Where | Depends on |
|---|---|---|---|
| C1 | P entry binding: refuse when the served `entry.entry_id` differs from the reference's local block. Without it, a registry can serve another signed P entry of the same publisher for any local block (§XVI.6.5 "Entry context, assignment, and version"; §XVI.16 "Entry substitution or stale version") | `wrc/entryDesignator.ts:141-163` or Gate 3 | — (annex) |
| C2 | DNS `part=` proof for every `domains[]` entry the client relies on, not only index 0 | `wrc/namespaceDirectory.ts:479-492` | — (annex) |
| C3 | Use the directory status for the SC responder check | `wrc/gatePipelineAdapter.ts:290-303` | Q25 |
| C4 | Decode `connector` in the directory record | `wrc/namespaceDirectory.ts:115-162` | Q22 |
| C5 | Refuse a namespace whose `grammar_version` the client does not implement | `wrc/namespaceDirectory.ts:133` | Q23 |
| C6 | Fetch operator rollovers, decode each with `decodeOperatorRollover`, and fold them from the pinned anchor | `wrc/wrcRuntime.ts:207-214`, `wrc/namespaceDirectory.ts:164-214` | Q24 |
| C7 | Send the account credential on entry and object reads; map `401 account_required` to its own reason, not the capture-error path | `wrc/wrcTransport.ts`, `wrc/resolutionClient.ts` | Q20 |
| C8 | Check `display_origin` normalization and membership in `domains[]` before rendering | S5 | — (annex) |

C1 and C2 are annex conformance fixes and needed no decision. Both are **implemented in `6285f397`**, each with tests that pin the refusal (`docs/analysis/iteration-02-2026-09-26.md`).

C1 was first confirmed with a throwaway probe while drafting. The fixture registry served entry `OTHER` under the local block of `P-WR7X4K-K7Q4MQ`, and the pipeline passed all six gates and released `OTHER`'s EVP. Before `6285f397`, the suites pinned the equivalent refusal for combination classes only (`wrc/__tests__/fullChain.e2e.test.ts:494`).

---

## 10. Input for the local WR Code test backend (next Milestone-2 step)

- **What it serves:** resolve, entries by lookup key, objects, directory, manifest, and a `_wr` TXT answer. The fixture generator `wrc/__tests__/wrcFixtures.ts` already builds every as-built object with correct signatures and can seed it.
- **Keys it needs:**
  - a directory operator pair, pinned through `WRDESK_WRC_DIRECTORY_OPERATOR_KID` and `…_PUBKEY`;
  - an ingest countersigner, `WRDESK_WRC_INGEST_PUBKEY`;
  - a root key per test publisher, optionally with a catalog delegation.
- **Reachability constraint:** the production transport cannot reach a local server. It refuses loopback and private addresses and non-public certificates (§4.6), and DNS goes through the system resolver (`wrc/wrcTransport.ts:101-108`). The backend step must choose between injecting a dev transport through the existing seam (`wrc/wrcTransport.ts:1-16`) and adding an explicit, dev-only address allowance. That choice belongs to that step, not to this contract.

---

## 11. Questions for the Author

The numbering continues the resync Q-register (Q1–Q19).

**Q20 — Disclosure tiers (§6): adopt the public/account split, and which credential does the registry accept?**
- A: the split as in §6, with an OIDC bearer token from the product SSO (the registry is its own audience). A "public sub-handshake" is an S* entry the publisher explicitly declares `visibility: "public"`; C and I entries are never public.
- B: the same split, with requests signed by the Principal Key plus a Delegation Certificate. This needs per-account keys (Q19 = A).
- C: keep every read public. This conflicts with §XVI.6.3 and ruling 3.
- Recommended: **A**, because it needs no new key provisioning, and submit and accept are session-bound after S2b anyway.

**Q21 — Entry lookup keys (§4.2): keep one unqualified path, or qualify by class?**
- A: one path; lookup keys unique per publisher across all key families, enforced by ingest rejection.
- B: a required `cls` query parameter, plus a separate repository-id path for parent lookups. This is a client change.
- Recommended: **A**. Collisions already fail closed, and the rule costs the client nothing.

**Q22 — Add the §XVI.6.4 `connector` field to the directory record now?**
- A: yes, as `"connector": { "script_version": string, "code_hash": "sha256:…" | null }`, present on every record, with the client decoder change (C4) in the same slice as the test backend.
- B: only once signed-WR-script-block verification (§XVI.7.4a) is built.
- Recommended: **A**. The annex requires the content, and the record is closed, so adding it later breaks every deployed client.

**Q23 — `grammar_version`: what value, and does the client check it?**
- A: the reference-grammar version as a string (`"2"` for Registry Material v2.0), and the client refuses a namespace whose grammar it does not implement (C5).
- B: informational only.
- Recommended: **A** (fail closed).

**Q24 — How do operator rollover records reach the client?**
- A: a public, append-only `GET /v1/directory/operator-rollovers`, folded from the pinned anchor at startup (C6). Each link is dual-signed, so the channel adds no trust.
- B: shipped with the runtime only.
- Recommended: **A**, so an operator rollover does not require a runtime release.

**Q25 — Which namespace status does the client trust?**
- A: the directory record's, everywhere, including the SC responder (C3). The resolve `status` becomes informational and must equal the directory's.
- B: keep both as they are.
- Recommended: **A**, because only the directory status is signed.

**Q26 — When does the client route to the directory's `resolver_endpoints` (ruling 3d)?**
- A: not in v2.0. v2.0 is single-registry; `resolver_endpoints[0]` must name `<registry>/v1/publishers/<part>`, and routing through the directory arrives with federation.
- B: route entry lookups to `resolver_endpoints[0]` now.
- Recommended: **A**. There is one registry today, and routing adds a new outbound origin per namespace.

**Q27 — Align the relay and capsule objects, the Delegation Certificate and the key-history fields with A.4.1–A.4.4 now, or in S7?**
- A: in S7, as contract v2.1: the wire endpoints of §7.3 plus certificate `generation` and validity, the multi-responder capsule, `encryption_keys[]`, and key validity windows.
- B: now, in v2.0.
- Recommended: **A**. None of these legs has a wire yet, and S7 needs the WRC service anyway.

Ratified answers (Author, 2026-09-26):

`Q20: A  Q21: A  Q22: A  Q23: A  Q24: A  Q25: A  Q26: A  Q27: A`

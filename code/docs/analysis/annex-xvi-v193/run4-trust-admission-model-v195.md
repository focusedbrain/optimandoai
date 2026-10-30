# Run 4 Trust / Admission Model — Annex XVI v1.95 (normative mapping)

Authority: `docs/spec/Annex_XVI_WR_Code_v1.95.pdf`
(SHA256 `064AAD6D8F28A0B1B7688C516CA3C4D8BA486BF723A5483D8C119D44F875829F`).
This documents the remaining Annex-defined trust chains BEFORE implementation.
Distinct concepts stay distinct throughout: publisher ≠ principal ≠ device ≠
session ≠ entry ≠ namespace ≠ counterparty ≠ receiving party.

## 1. Namespace Directory trust chain (§XVI.6.4)

The directory maps each Publisher Identifier to a signed **Namespace
Directory Record** containing at least: the publisher's current verification
key(s) and key generation; resolver endpoint(s); Relay endpoint(s) for
capsule and acceptance delivery; grammar version; WR Connect script version
(+ connector hash where customized); bound origin(s)/domain(s); namespace
status (ACTIVE / INACTIVE / REVOKED / SUPERSEDED / COMPROMISED); record
generation and expiry.

Verification chain, all fail-closed:

1. **Operator signature** — records are signed by the directory operator's
   key; the operator public key is the **pinned trust anchor** distributed
   with the runtime. Key rollover only via a rollover record signed by BOTH
   the outgoing and incoming operator keys, verified before any record signed
   by the new key is accepted.
2. **Publisher countersignature** — every record update is countersigned by
   the publisher, so neither the operator alone nor the publisher alone can
   alter an active record. Initial registration is an out-of-band,
   operator-vetted act (account-holder vetting per operator policy).
3. **Generation** — every change increments the generation; a cached record
   whose generation no longer matches is invalidated immediately regardless
   of remaining expiry. Expiry is an upper bound on cache life, never a
   promise of validity. Implementation: a monotonic generation floor per
   part (same discipline as the existing epoch floor).
4. **Status** — non-ACTIVE stops Gate 2 (superseded surfaces the successor
   explicitly; compromised carries the unsuppressible warning class).
5. **Anti-enumeration** — lookups are namespace-keyed, no identity required;
   uniform unknown-identifier behavior (§XVI.4.2) is preserved.

**Account holder + domain control (§XVI.6.5):** verified only when BOTH
hold — the record identifies a vetted account holder AND a valid DNS entry
under the publisher's own domain names that Publisher Identifier. Missing /
expired / mismatched DNS → not verified regardless of the record; DNS
without matching record → not verified. Both are re-checked within caching
limits on every resolution. C references verify BOTH sides; one unverified
side → not verified.

**Publisher key binding (§XVI.6.5):** every publisher-signed artifact is
verified against a directory-registered key, or a Principal Key whose
**Delegation Certificate** chains to one — never against key material carried
by the artifact itself. Verifiers check delegation scope, generation, expiry;
revoked/out-of-scope delegation = invalid signature.

**SSO / email-domain agreement (§XVI.6.5):** a principal acts for a publisher
(initiate, accept, claim, sign) only if the domain of its SSO-verified email
is one of the publisher's DNS-verified domains at signature time. Gate 2
additionally requires the receiver's own acting principal's SSO email to lie
in its own publisher's DNS-verified domain, "otherwise it cannot claim on the
publisher's behalf" (§XVI.7.6 Gate 2). Individuals (B2C) have no DNS; they
are verified by SSO Identity — one verified email per principal, bound into
the Party Binding (§XVI.6.5 "Individual parties").

## 2. SE session semantics (§XVI.5.7, §XVI.5.10)

SE differs by lifecycle, not form: exists **only under an established parent
handshake** (any class); bound to a **session or bounded time window**; not
durable; resolves only while its session and expiry are valid; afterwards it
is **EXPIRED** and the identifier is never reissued (P11). Promotion to a
durable SP/SI/SC creates a NEW binding (§XVI.13.2). "Expiry, replay, session
binding, and authorization remain separate state and are not replaced by the
check." No renewal/extension is defined for SE — none is implemented.
Session expiry is therefore its own axis, distinct from entry
inactive/revoked/superseded/compromised and from the §XVI.8.4 use states;
parent ineligibility (revoked / superseded / compromised / inactive /
suspended) refuses via the governing-parent check, not by mutating SE state.

## 3. Device Pass / Registered Counterpart Device (§XVI.13.7)

- **Device Record** — created only by an I pairing handshake under the
  tenant: binds Device Name → Device Class → key fingerprint → principal,
  signed by the tenant under the I umbrella; verified against the tenant's
  verification key from its Directory Record. Renaming changes display +
  generation, not identity; revoking the device revokes the record and every
  reference bound to it resolves to REVOKED (generation check at each
  resolution).
- **Device Pass** (high-assurance device-bound SC): (1) precondition —
  device paired in the responder's tenant; (2) registration — over the
  sealed channel of the C relationship the device presents its Device Record
  and proves key possession, with consent on that device; (3) verification —
  the initiator verifies the tenant signature against the responder's
  directory-registered key (Gate-2 assurance), the record's generation and
  status, and fingerprint equality; (4) effect — the record is held as a
  **Registered Counterpart Device of THIS C relationship**; SC references may
  bind to it, resolving only on that device (all others, including sibling
  devices of the same principal, get NOT_FOR_THIS_DEVICE); (5) lifecycle —
  revocable by either side, expiring, renewable; never extends to a second
  device or identity.
- The pass is the ONLY route by which a device is addressable outside its
  tenant (known-identifier rule): the initiator binds only what its own
  repository holds, and holds it only because the counterpart put it there.
  A registration under one C pair confers nothing under another pair.

## 4. Pairing slots (§XVI.5.10 "I pairing", §XVI.8.4)

A slot is an ordinary **I-class entry** in the tenant's own namespace — no
separate identity namespace: context constituent = the Pairing Slot,
receiving party = the principal (the device is unknown, so the code carries
no device constituent). Optional expected Device Class and expiry.
**Single-use by construction: §XVI.8.4 with consume_at = acceptance.** The
pairing act: the new device authenticates as the SAME SSO Identity, presents
its fresh key + Device Class, receives its Device Name; the tenant checks
the class expectation, registers key/class/name; the Device Record and the
Device-Scoped Principal Identifier come into existence at that moment; the
slot is **superseded by the resulting Device Record**. A different email
identity cannot pair.

## 5. Gate 5 — Recipient-bound release (Relay) (§XVI.7.6, §XVI.7.5.5)

The receiver presents a claim **signed with its Principal Key** and, where
acting for a publisher, its **Delegation Certificate with accept scope**.
Ordered release predicates (each fail-closed):

1. claim signature verifies;
2. the delegation chains to a directory-registered key of the Publisher
   Identifier named as recipient in the capsule — or, for an individual, the
   Principal Identifier matches; release is to a claim that chains to a Party
   Identifier named in the capsule, never to mere possession of the
   reference (§XVI.7.5.5);
3. the capsule is not expired, withdrawn, or already terminal;
4. rate and replay limits are satisfied.

The Relay releases **ciphertext plus signed envelope; it can decrypt
nothing** (it cannot decrypt nonce_I). Protected relay material is
observable only after Gate 5 passes. §XVI.8.4: successful passage through
Gate 5 by an identified party takes the atomic CLAIM (existing Run-2 CAS).

## 6. Gate 6 — Capsule admission (§XVI.7.6, §XVI.7.5.2/7)

The Pending Handshake-Request Capsule carries: request_instance_id, ordered
Party Bindings of both parties (Party Identifiers + verified emails),
requested profile/scope, nonce_I encrypted to the recipient publisher's
directory-registered **encryption key**, H(nonce_I) in the clear, freshness
and expiry data, and the initiator's Delegation Certificate. Ordered
admission checks (each fail-closed, before any UI):

1. capsule signature against the initiator's directory-registered key or a
   valid Delegation Certificate chaining to it;
2. initiator's account-holder + DNS status re-verified at admission time;
   the initiating principal's SSO email in the Delegation Certificate lies in
   the initiator's DNS-verified domain;
3. both Party Bindings well-formed; the receiver-side binding names the
   receiver's own Party Identifier and its own verified email;
4. request_instance_id is new — or maps to existing state, in which case
   existing state is surfaced instead (idempotency, §XVI.7.5.9);
5. freshness and expiry;
6. nonce_I decrypts under the receiver's key and hashes to the clear
   H(nonce_I);
7. requested profile/scope admissible under receiver and tenant policy;
8. no field references a link, external resource, or unregistered carrier
   (P15 — already pipeline-owned, non-delegable).

Only after Gate 6 does the request exist for the user (PENDING-RECEIVED).
Consumption ordering (§XVI.8.4): consume_at = acceptance is the default —
admission does NOT consume; the user's explicit acceptance does. Any failure
after the Gate-5 claim reverts the claim (Run-2 invariant preserved).

## 7. Establishment Commitment (§XVI.13.6)

EC is computed by both parties AT establishment (over capsule hash,
acceptance hash, nonces) and evidences that a handshake existed; it grants
no capability and no gate of §XVI.7.6 lists EC as a pre-admission input.
A resolver never returns EC or nonce material for a C/SC reference.
Therefore EC is **not** a normative prerequisite of Gates 5/6, Device Pass
registration verification, pairing, or SE resolution — it remains an
attachment seam (the capsule/acceptance hashes it binds are produced here).

## 8. Implementation mapping (this repo)

- Directory: new `wrc/directory-record` wire object + verifier
  (`namespaceDirectory.ts`), served over the existing transport seam
  (§XVI.6.4 allows service / DNS / federated embodiments — the transport IS
  that seam). Pinned operator anchor injected; rollover records verified.
  Gate-2 adapter consumes ONLY this chain; the Phase-3 resolution chain
  remains Gate 3's entry substrate, cross-checked so the resolver's signing
  root must be a directory-registered key.
- SE: `session {id, not_before, expires_at}` on the resolver designation,
  evaluated at Gate 3 with the deps clock; EXPIRED surfaces the existing
  `entry_expired`; a not-yet-valid session gets its own reason.
- Device Pass: `deviceRegistry.ts` — tenant-signed Device Records +
  per-C-pair Registered Counterpart Device store; consulted at Gate 4 for
  device-granularity SC. Key-possession proof belongs to the P2P session
  establishment (out of scope); the record chain, binding, and lifecycle
  checks are in scope.
- Pairing: slots are I entries with `slot` designation metadata + §XVI.8.4
  declaration (use_limit 1, consume_at acceptance); pairing completion
  consumes the slot atomically and mints the Device Record inside the
  trusted boundary.
- Gate 5: `relayRelease.ts` — claim construction (receiver side) + ordered
  relay verification (contract-faithful double), keyed to the capsule the
  directory-named Relay holds; protected ciphertext only on pass.
- Gate 6: `capsuleAdmission.ts` — ordered checks above; x25519+HKDF+AES-GCM
  sealing for nonce_I (the annex requires an encryption key in the directory
  record; the record carries it); request_instance_id replay store.

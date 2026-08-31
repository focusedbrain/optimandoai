# WR Code v1.95 Run 4 — Directory Trust, Session/Device Binding, Relay Release, Capsule Admission

Branch `integration/consolidated-current`; authority
`docs/spec/Annex_XVI_WR_Code_v1.95.pdf` @ SHA256 `064AAD6D…829F`, verified at
run start and re-verified at completion (identical). Normative model
documented BEFORE implementation in `run4-trust-admission-model-v195.md`.

## Commits per slice

| Slice | Commit | What |
| --- | --- | --- |
| 1 model | `cb6fa798` | Run-4 normative trust/admission model (§ citations) |
| 2 Directory/SSO | `487eecd5` | Namespace Directory replaces Gate-2 interim anchor |
| 3 SE lifecycle | `6f1965f8` | SE session/expiry per §XVI.5.7 |
| 4 Device Pass | `2b23f44e` | Device Record / Device Pass / Registered Counterpart Device (§XVI.13.7) |
| 5 pairing slots | `c1a71fe3` | Pairing slots wired into entry + device model (§XVI.5.10) |
| 6 Gate 5 | `19ab5708` | Relay-Release ordered chain (§XVI.7.6 Gate 5, §XVI.7.5.5/9) |
| 7 Gate 6 | `43eb1fb5` | Capsule-Admission ordered chain + sealed nonce (§XVI.7.6 Gate 6, §XVI.7.5.2/7) |
| 8 conformance | (this commit) | Full-chain matrix + report |

## Directory / SSO (Gate 2) — the interim anchor is GONE

`namespaceDirectory.ts`: dual-signed Directory Record (operator signature
over record−both sigs, publisher countersignature over record−countersig, so
neither party alone alters an active record), pinned operator trust anchor
with dual-signed rollover records, per-part monotonic generation floor,
expiry as cache bound, vetted-account-holder attestation, DNS part proof
(`v=wr1 … part=<PART>` under the record's own domain) re-checked per
resolution, status vocabulary with explicit successor for SUPERSEDED and the
unsuppressible warning class for COMPROMISED. `WrcDirectoryClient` is the
ONLY Gate-2 trust path: `createWrcGateDeps` without a directory refuses
`namespace_unverified: directory_not_configured` — no registry fallback, no
silent compatibility path (proven by test). The Phase-3 chain remains what it
is normatively: the Gate-3 publisher-resolver leg, now cross-checked so its
signing root MUST be a directory-registered key (§XVI.6.5 key binding).
SSO binding (§XVI.6.5/7.6): a receiver acting for a publisher with an SSO
email must have that email's domain among the publisher's DNS-verified
domains — `sso_principal_mismatch` otherwise, fail-closed when unverifiable.

## SE session lifecycle (Gate 3, §XVI.5.7)

`session {id, not_before|null, expires_at}` rides the publisher-signed
designation; the PIPELINE (not the adapter, not a caller) evaluates the
window with the injected clock. SE without a session refuses
(`designation_mismatch`); before `not_before` → `session_not_yet_valid`;
past `expires_at` → `entry_expired` (the annex's own word; P11 never
reissues). Session state stays a separate axis from entry lifecycle,
§XVI.8.4 use states, and parent eligibility (`unresolved_parent`) — nothing
merged, as the annex merges nothing. No renewal/extension implemented: none
is defined.

## Device Pass / Registered Counterpart Device (Gate 4, §XVI.13.7)

`deviceRegistry.ts`: tenant-signed Device Record (device name/class/key
fingerprint/principal, generation, status) verified against the tenant's
directory-registered keys; Device Pass binds a record to ONE ordered C pair
with registration time, expiry, withdrawal. Gate 4 (after the local
self-match, which stays pipeline-owned): SI device selection verifies the
TENANT record; device-bound SC verifies the pass under exactly this
initiator↔responder pair, current generation, unexpired, not withdrawn,
record signature against the RESPONDER's directory keys. No substrate = no
pass (`device_binding_unverified`, leg detail carries the precise reason).
Cross-establishment substitution, sibling devices, stale generations,
revocation, expiry, foreign-tenant records: all refusing vectors.

## Pairing slots (§XVI.5.10, §XVI.8.4)

No second identity namespace: a slot IS an I entry (`pairing {slot,
expected_device_class|null, expires_at|null}` on the signed designation),
its principal binding IS Gate 4, its single-use IS the Run-2 §XVI.8.4 CAS
(`consume_at = acceptance`). `pairingSlots.ts#acceptDevicePairing` is the
only route from pairing code to Device Record: full six-gate run first, then
slot checks (pairing block, slot expiry, Device Class expectation), then the
tenant-signed record is verified against directory keys BEFORE the atomic
consume, then registration mints the Device-Scoped Principal Identifier
(§XVI.2). Every acceptance-stage failure releases the Gate-5 claim; racing
acceptances get one winner. Reason codes: `not_a_pairing_slot`,
`pairing_identity_incomplete`, `slot_expired`, `device_class_mismatch`,
`record_registration_failed`, `slot_not_consumable`.

## Gate 5 — Relay-Release (§XVI.7.6, §XVI.7.5.5/9)

`relayRelease.ts`, the annex's order verbatim: (1) claim signature (receiver
Principal Key); (2) chain to a Party Identifier NAMED IN THE CAPSULE — for a
publisher recipient the Delegation Certificate must chain to that
publisher's directory-registered key with `accept` scope, unexpired, binding
exactly the claiming principal AND its key; for an individual the Principal
Identifier (and bound key fingerprint when present) matches — possession of
the reference is never entitlement; (3) capsule not expired / withdrawn /
terminal — reachable only BEHIND the identity legs (enumeration
protection); (4) rate + replay — request ids bind to their first claimant
(same party idempotent per §XVI.7.5.9, another party refused). The relay
holds sealed capsules and exposes NOTHING but presence/id outside `release`
(pinned by test on its surface). Claims are assembled and signed inside the
adapter (`claimIdentity` seam); the released material enters
`released.capsule` still sealed. Legs: `claim_malformed/claim_sig_invalid/
delegation_{missing,sig_invalid,key_unregistered,scope_missing,expired,
principal_mismatch}/recipient_{publisher,party,key}_mismatch/
capsule_{unknown,expired,withdrawn,terminal}/claim_replayed/rate_limited/
directory_unavailable`.

## Gate 6 — Capsule-Admission (§XVI.7.6, §XVI.7.5.2/7)

`capsuleAdmission.ts`, the annex's order verbatim over the RELAY-RELEASED
bytes (never caller-provided): capsule signature via the initiator's
Delegation Certificate (`initiate` scope) chaining to a directory-registered
key; initiator status + vetting RE-verified at admission time (fresh
directory fetch, not the Gate-2 result); initiator SSO email inside the
DNS-verified domain; both Party Bindings well-formed, recipient binding
names the receiver's own Party Identifier and own verified email;
`request_instance_id` new or idempotent (same capsule surfaces existing
state; different capsule refuses `request_replayed`); freshness (future
`issued_at` beyond skew refuses) and expiry; nonce_I opens under the
recipient's X25519 key (X25519 ECDH → HKDF-SHA256 → AES-256-GCM,
context-bound to the capsule id so sealed nonces cannot be transplanted) and
hashes to the clear H(nonce_I); scope admissible under the receiver/tenant
policy hook; P15 link scan stays pipeline-owned. Where the capsule repeats
an identity established earlier (initiator part), EQUALITY is verified
(`initiator_mismatch`), never replacement. One explicit result: admitted or
a deterministic leg.

Consumption ordering (Run-2 invariant preserved and proven): the Gate-5
claim is held through admission; ANY Gate-6 failure reverts it to ACTIVE;
successful admission leaves it CLAIMED — the user's explicit acceptance
(`consume_at = acceptance`) spends the use, exactly once, racing acceptances
get one winner.

## Reason codes added (ownership per gate)

- Gate 2: `sso_principal_mismatch` (+ directory legs in detail:
  `operator_sig_invalid`, `publisher_countersig_invalid`, `part_mismatch`,
  `record_expired`, `generation_stale`, `account_not_vetted`,
  `dns_part_mismatch`, `operator_key_unknown`, `record_malformed`, …).
- Gate 3: `session_not_yet_valid` (SE window; expiry reuses `entry_expired`).
- Gate 4: `device_binding_unverified` (+ registry legs in detail).
- Gate 5: `release_refused`/`relay_unavailable` with the release-leg
  vocabulary in detail (see above).
- Gate 6: `admission_refused` with the admission-leg vocabulary in detail.
- Pairing acceptance boundary: the six codes listed above.

## Persistence

No schema change and no migration in Run 4. Directory generation floors and
the admission replay ledger are process-local (conservative default; a
native-DB mirror is an operational hardening seam). Relay envelopes, device
records/passes, and pairing state live behind interfaces with in-memory
reference implementations; `wrc_entry_use_state` rows, Run-2 bare P keys,
Run-3 canonical keys, legacy rows, and consent/preview data are untouched.
No identifier reissue; no reinterpretation of historical rows.

## Operational defaults chosen (annex leaves the value open)

- Relay rate limit: 10 release attempts / 60 s per capsule
  (`WRDESK_WRC_RELAY_RATE_LIMIT`, `WRDESK_WRC_RELAY_RATE_WINDOW_S`).
- Admission clock skew for `issued_at`: 300 s (`skewS` parameter).
- Scope policy default: requested scope admitted after all other legs
  (receiver/tenant policy hook `scopeAdmissible` for restriction).
- Claim timeout stays the Run-2 600 s (`WRDESK_WRC_CLAIM_TIMEOUT_S`).
- Sealed-box construction: X25519 + HKDF-SHA256 + AES-256-GCM, capsule-id
  context (the annex names the directory-registered encryption key; the
  concrete AEAD construction is the implementation seam).

## Full-chain test matrix

`fullChain.e2e.test.ts` (22): one full six-gate success vector per class
(P, I, C, SP, SI, SC, SE — the C row recipient-bound through relay +
capsule), one deterministic failure per gate (1–6), and the observability
proofs: gate N+1 unreachable past a failed gate N (spies), refusals carry no
material, the relay surface exposes nothing but presence/id, caller-injected
designator/released/material fields are ignored, no directory → no trust
path, no device substrate → no device admission, lying resolver expansion →
`designation_mismatch`. Plus per-slice suites: `directoryGate2.e2e` (Gate-2
chain incl. rollover, tamper, substitution, rollback, SSO),
`seSessionLifecycle.e2e` (10), `devicePass.e2e` (12), `pairingSlots.e2e`
(10), `relayRelease.e2e` (16), `capsuleAdmission.e2e` (17). WRC module
total: 19 files, 338 passed / 20 skipped.

## Regression (sanctioned runner `pnpm test:native-db`)

Before (Slice 0): 6400 tests, 154 failing identities. After: 6507 tests,
154 failing identities — **identical sets, 0 regressions, 0 baseline-only
now green**, +107 new passing tests (the Run-4 suites). Known flaky
movement: none observed in this pair (the previously noted hardware-probe
flake did not move).

## Remaining Annex XVI attachment points

- Transport-backed relay + directory service endpoints (memory reference
  implementations stand behind `WrcRelayClient` / `WrcTransport.directoryRecord`;
  the wire seam exists, an operational deployment binds it).
- Acceptance record / establishment step (§XVI.7.5.8): nonce_R, acceptance
  countersignature, Establishment Commitment computation (§XVI.13.6 — still
  no gate lists EC as a pre-admission input; attachment seam only).
- Handshake State Index recording (PENDING-RECEIVED after Gate 6) and the
  trusted-UI surfaces (P12) — product layer, out of Run-4 scope.
- Device Pass key-possession proof rides the P2P session establishment
  (§XVI.13.7 step 2) — the record/pass verification chain is in scope and
  done; the live proof-of-possession protocol is a later transport concern.
- §XVI.13.x umbrella/session binding beyond SE, Displayed Responsible
  Domain / OCR cross-check, catalog blocks (§XVI.7.2a), trigger catalog
  (§XVI.7.7a): unchanged attachment points.

## Consciously deferred (non-normative)

Runtime wiring of relay/device/admission deps into `wrcRuntime.ts` beyond
the directory client (no product surface consumes recipient-bound C release
yet; the adapter seams — `relay`, `devices`, `claimIdentity`, `admission` —
are the injection points and are fully covered by tests). Persistent
(native-DB) stores for generation floors, replay ledger, device registry:
additive follow-ups behind existing interfaces.

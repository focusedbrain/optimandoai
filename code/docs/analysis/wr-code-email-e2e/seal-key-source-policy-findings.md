# NAMED ITEM — “seal-key-source policy unification”
## Bounded DIAGNOSIS at Phase-4 entry — findings only, no implementation

**Status:** DIAGNOSIS COMPLETE. No code changed. Implementation is gated on
author approval, per the ruling.

Two mechanisms decide which key verifies a sealed inbox row, and they do not
agree. This maps every call site, states which one is authoritative, and
proposes a unification.

---

## 1. The two mechanisms

### (a) `sealedQuery`'s per-row routing — `rowKeySource`

`electron/main/sealed-storage/index.ts`:

```
seal_key_source === 'ledger' → outer provider
anything else (incl. 'vmk', NULL, unknown) → inner provider
```

One provider, chosen from the row's own tag, no fallback. If that provider is
unbound the row is filtered and a tamper event is recorded.

### (b) The policy module — `inboxRowSealPolicy.ts`

```
inboxRowRequiresInnerVault(row)   ← source_type + handshake confidentiality
effectiveInboxRowSealKeySource(row) → 'vmk' | 'ledger'   (what it SHOULD be)
verificationKeySourcesForInboxRow(row) → ['inner'] | ['outer', 'inner']
```

For a non-confidential row it returns a TRY LIST of two providers. That second
entry is not redundancy for its own sake: it is how a legacy row that was
historically inner-sealed under an outer-policy shape stays readable, after
which `inboxSealedRead` re-seals it to the ledger key.

## 2. Call-site map (production, complete)

| # | Call site | Routing used | Policy consulted |
|---|---|---|---|
| 1 | `email/inboxSealedRead.ts:75` (via the try-list at :134) | `forceKeySource`, per policy | **Yes** |
| 2 | `handshake/ipc.ts:3580` — `beapInbox.list` | default `rowKeySource` | No |
| 3 | `handshake/ipc.ts:3594` — `beapInbox.list` (cursor branch) | default `rowKeySource` | No |
| 4 | `handshake/ipc.ts:3668` — `beapInbox.getMany` | default `rowKeySource` | No |
| 5 | `email/sealedContentUpdate.ts:170` | default `rowKeySource` | No |
| 6 | `email/beapInboxClonePrepare.ts:415` | default `rowKeySource` | No |

**One of six call sites uses the policy.** Site 1 backs the Electron inbox
(`loadVerifiedInboxMessageById` at `email/ipc.ts:3407` and `:3435`, plus list
reads). Sites 2–4 back the EXTENSION inbox over the loopback RPC.

## 3. The consequence, stated plainly

A legacy inner-sealed, non-confidential row behaves differently depending on
which surface asks:

- **Electron inbox** (site 1): the policy tries `outer`, fails, tries `inner`,
  succeeds, and then re-seals the row to the ledger key. The user sees the
  message, and the drift self-heals.
- **Extension inbox** (sites 2–4): `rowKeySource` maps `vmk` → inner only. If
  the inner vault is locked, the row is filtered and a tamper event is
  recorded. The user does not see the message, and nothing heals.

So the same row is visible in one inbox and absent from the other, and the
absent case also emits tamper telemetry for a row that is not tampered. This is
wider than the Phase-3 report suggested: it framed the divergence as
`inboxSealedRead` vs `beapInboxClonePrepare`, but the extension's entire inbox
list is on the unpolicied path.

Site 5 (`sealedContentUpdate`) and site 6 (clone prepare) inherit the same
behaviour on the write-back and clone paths respectively.

## 4. Which is authoritative

**The policy module is authoritative for WHICH PROVIDERS MAY BE TRIED. The row
tag remains authoritative for WHAT THE ROW WAS SEALED WITH.**

They answer different questions and neither is wrong on its own terms:

- `seal_key_source` is a historical fact about a row. It cannot be
  authoritative for verification policy, because it is exactly the field that
  is stale on legacy rows — the case the try-list exists to handle.
- `verificationKeySourcesForInboxRow` is derived from the row's *content class*
  (depackaged email is never confidential; a confidential handshake always is).
  That is a policy statement, and it is the one that already governs the
  surface with the richest behaviour, including the reseal-forward migration.

Evidence that this is the intended direction rather than an accident: the policy
module carries `allowsLegacyOuterReseal` and `effectiveInboxRowSealKeySource`,
both of which exist only to reconcile a row tag with the policy. Nothing in the
sealed-storage gate knows about content classes at all.

## 5. Proposed unification (NOT implemented)

**Option A — teach `sealedQuery` the try-list (recommended).**
Add an optional `keySources?: KeySource[]` to `SealedQueryOptions`. When
present, each row is attempted against those providers in order and is only
filtered when all fail. `rowKeySource` remains the default for callers that
pass nothing, so no behaviour changes until a call site opts in. Then move
sites 2–6 to pass `verificationKeySourcesForInboxRow(row)`.

- Pro: one code path, per-row policy, no duplication of the reseal logic.
- Con: `sealed-storage` gains a notion it currently lacks — but as an injected
  list, not as knowledge of email content classes, so the layering holds.

**Option B — route every inbox read through `inboxSealedRead`.**
Make sites 2–6 call `verifyInboxMessageRowOrNull` instead of `sealedQuery`.

- Pro: no change to the gate; reseal-forward comes for free everywhere.
- Con: `inboxSealedRead` is row-at-a-time and the list paths are batch; a
  paginated list of 200 rows would become 200 verify calls plus potential
  reseals mid-list. Needs a batch entry point first.

**Option C — do nothing and document the asymmetry.** Rejected in this
analysis: the observable behaviour is a message that exists in one inbox and
not the other, plus false tamper telemetry. That is not a documentable quirk.

**Recommendation: Option A**, then migrate sites 2–4 first (the extension inbox,
where the user-visible asymmetry lives), then 5 and 6.

## 6. Risks to weigh before approving

- Sites 2–4 are the extension's sealed read path. Any change there touches the
  boundary that PR B-8 established; the five remediated suites plus
  `b81BeapInboxPagination` and `b8BeapInboxIpc` are the regression surface.
- Reseal-on-read during a paginated list is a write during a read. Site 1 does
  it one row at a time under a user-visible detail view; doing it inside a
  200-row list needs an explicit decision.
- Tamper telemetry currently fires for the legacy case. If Option A lands, that
  event stops firing for those rows — which is correct, but it will change the
  shape of any dashboard counting those events.

No fix is applied. The author decides.

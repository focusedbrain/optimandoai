# Build C — ACCEPTED CONDITIONALLY. Weak-key task + PR instructions (docs/build-specs/0020)

Commit this as `docs/build-specs/0020-build-c-acceptance.md` on `build-c/critical-job-handshake`, then execute in order.

## 1. Deviation rulings

Deviations 1–5 of report `0018` are APPROVED, recorded as follows: synchronous response delivery is the v1 contract (bounded by the dispatcher timeout; async/reverse-POST delivery is a pluggable-transport follow-up to be revisited when the W-series exercises real cross-device links); WebRTC-DC carriage and `cancel` deferred per spec; receiver anti-loop omission is correct by architecture (no legitimate two-hop remote exists — consumers dispatch follow-up jobs themselves); view-attachment custody default-false is the intended fail-closed posture. Update `0018` deviation entries to APPROVED with these one-line rationales.

## 2. Weak-key finding — classify and, if reachable, harden (BLOCKS MERGE)

The all-zero Ed25519 observation is reclassified from "observation" to **security finding**. Tasks:

1. **Classify reachability:** where does the all-zero key appear (file:line), and can any production verification boundary be presented with it — specifically `verifyJobResultSignature` (`hypervisorProvider.ts:153`), capsule signature verification (`handshake/enforcement.ts`), and the new `critical_job_*` gate? Test-fixture-only → record and go to step 3.
2. **If production-reachable:** add weak-key rejection at the verification boundaries — reject the all-zero/identity point and small-order points before signature verification, with unit tests (zero key, small-order key, valid key) at each boundary. Keep the change minimal and boundary-local; do not refactor key plumbing.
3. **Either way:** one paragraph in `0018` (or an addendum) stating the classification, the library's existing behavior on weak keys (verified, not assumed — test it), and what was added. INV-7 applies: unverified library behavior at a trust boundary counts as risk.

## 3. Pull request

Open the PR `build-c/critical-job-handshake` → `feature/layered-sandbox` AFTER §2 is resolved. PR description: link specs `0017`/`0018`/`0020`; state "inert without linked topology" with the no-topology regression test named; and a review-focus list for O: (a) the receiving gate (same-principal/ACTIVE/size/replay/per-kind admission), (b) the sovereign re-dispatch + refusal paths (`E_REMOTE_KIND_REFUSED`, `E_KEY_LOCALITY`), (c) the wire types (no key material, no plaintext in errors), (d) the §2 weak-key resolution. Do not self-merge: O reviews and merges.

## 4. Status after merge (record in README index)

Build C: landed, inert pending topology configuration; acceptance evidence for real two-machine operation = W-series (`0019`), to be run alongside the V-series in the hardware session. Queue unchanged: hardware session (V + W) → B2 acceptance + topology (b) demonstration → `decrypt-qbeap` → appliance role build → fetch relocation → B1 default-flip cleanup.

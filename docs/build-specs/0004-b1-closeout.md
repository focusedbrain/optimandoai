# B1 — ACCEPTED. Closeout instructions.

The final report is accepted. The 4b5731c3 executor-gate refinement is approved as a correct and necessary deviation — the spec relaxed the table for the transitional kinds without saying to relax the executor's independent INV-1 gate in lockstep; your scoping (only the two validate kinds, untrusted-content ban untouched) is exactly right. The Site-3 finding (file import converges on processIncomingInput; single cutover covers it) is accepted with the ENTRYPOINT_AUDIT as evidence.

Three closeout tasks, then stop — do not start B2 or any decrypt-qbeap work:

1. **Dev-box parity run (owed from B.5.2):** execute the flag-on, end-to-end `validate-decrypted-beap` parity check with the REAL validator subprocess running (no mock) on this machine. Same corpus, same byte-identity criteria. Append the result to your report.
2. **Flake hygiene (trivial commit):** bump the `hardening.test.ts` timeout (or mark the suite serial) so the pre-existing ~4.9s/5s flake stops producing noise. One-line change, separate commit, clearly labeled as unrelated to B1.
3. **Spec persistence:** create `docs/build-specs/` in the repo and commit the B1 documents you hold (your contradiction report, Amendment 1, the consolidated B1 spec, and this closeout) as numbered files. From now on all build specs live there so no document can be lost to paste again.

Soak note (no action for you): the flag will be enabled on the dev machines for daily use. Default-flip + deletion of the inline else-paths is a later cleanup build after soak; do not delete anything now.

Carried forward (not yours to start): the deferred Build A rig proof (dispatcher-path microVM job on the mini-PC, blocked on the /dev/vhost-vsock ACL) moves into B2's critical path. B2 (email depackaging pipeline: raw mail → depackage → BEAP capsule) begins with an analysis spec that will arrive as a file in docs/build-specs/.

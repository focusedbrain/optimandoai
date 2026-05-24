# Phase 3 Tracker — Per-Message Cryptographic Certification

> **Phase 3 commits land on `phase-1/pod-becomes-hot-path`. Branch name is historical.**

Branch: `phase-1/pod-becomes-hot-path`  
Strategy ref: `docs/architecture/beap-high-assurance-strategy.md` (§2 certificate spec; §1.1 mode table; §1.3 certifier/verifier rows; §2.5 edge key lifecycle)  
Phase 1 ref: `docs/architecture/phase-1-tracker.md`  
Phase 2 ref: `docs/architecture/phase-2-tracker.md`

---

## Steps

- [x] **P3.0** — Confirm branch and create Phase 3 tracker *(this file)*
- [ ] **P3.1** — Certificate format types and canonical hashing (shared schema: `package_hash`, `capsule_canonical_hash`, `validation_result_digest`, acceptance rule helpers)
- [ ] **P3.2** — Certifier role container (`/certify` on REMOTE_EDGE; Ed25519 signing; holds private key in memory only)
- [ ] **P3.3** — Keycloak attestation flow (`sso_attestation` JWT binding `edge_pod_id` to `sub`; resolve Decision 6)
- [ ] **P3.4** — Verifier role container (`/verify-cert` on LOCAL_VERIFY; attested edge public keys; rejects on failure → quarantine)
- [ ] **P3.5** — REMOTE_EDGE pod manifest (ingestor → validator → depackager → certifier; no sealer)
- [ ] **P3.6** — LOCAL_VERIFY pod manifest (ingestor → verifier → validator → depackager → sealer; no certifier)
- [ ] **P3.7** — Edge key lifecycle in Electron (Ed25519 keypair generation, VMK encryption, one-shot deploy bundle for certifier)
- [ ] **P3.8** — pod-client edge routing (paid tier: send raw bytes to edge replica; receive depackaged payload + edge certificate)
- [ ] **P3.9** — LOCAL_VERIFY ingestion wiring (cert gate before full validator pipeline; **never** skip validation on cert pass)
- [ ] **P3.10** — End-to-end manual round-trip verification and Phase 3 close (deploy edge + local pods by hand; synthetic message; document manual deploy recipe)

---

## Status summary

| Step | State | Commit |
|------|-------|--------|
| P3.0 | ✅ done | P3.0: phase 3 tracker |
| P3.1 | ⬜ pending | — |
| P3.2 | ⬜ pending | — |
| P3.3 | ⬜ pending | — |
| P3.4 | ⬜ pending | — |
| P3.5 | ⬜ pending | — |
| P3.6 | ⬜ pending | — |
| P3.7 | ⬜ pending | — |
| P3.8 | ⬜ pending | — |
| P3.9 | ⬜ pending | — |
| P3.10 | ⬜ pending | — |

---

## Cert-is-a-gate rule (repeated for every step)

> **The certificate is a gate, NOT a substitute for validation.**
> The local pod ALWAYS runs the full validator after cert verification.
> If at any step you short-circuit validation because the cert verified, stop — that collapses the trust model.
> The cert tells the local pod: "these bytes survived a remote pod that you, the SSO-authenticated user, own."
> It does not tell the local pod the bytes are safe.

---

## Decisions deferred

| Decision | Resolution |
|----------|------------|
| **Decision 4 — Certificate TTL** | Default 24 h per strategy §2.2. Will be user-settable in the Phase 4 wizard. |
| **Decision 6 — Keycloak attestation mechanism** | Custom claim vs token-exchange grant — pick in P3.3. |

---

## Notes & deviations

*(Record any decisions made differently from the strategy here, with rationale.)*

### P3.0

- Step titles P3.1–P3.10 are derived from strategy §7 (Phase 3 scope) and the Phase 3 prompt preamble. Titles may be refined when individual prompts are run; deviations will be noted here.
- No wizard or automated deploy in Phase 3. Deployment is manual (`podman play kube` with hand-managed secrets). Wizard is Phase 4.
- Phase 1.5 (extension pod-client migration) remains deferred; Phase 3 does not block on it.

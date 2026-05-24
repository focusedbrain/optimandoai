# Phase 3 Tracker — Per-Message Cryptographic Certification

> **Phase 3 commits land on `phase-1/pod-becomes-hot-path`. Branch name is historical.**

Branch: `phase-1/pod-becomes-hot-path`  
Strategy ref: `docs/architecture/beap-high-assurance-strategy.md` (§2 certificate spec; §1.1 mode table; §1.3 certifier/verifier rows; §2.5 edge key lifecycle)  
Phase 1 ref: `docs/architecture/phase-1-tracker.md`  
Phase 2 ref: `docs/architecture/phase-2-tracker.md`

---

## Steps

- [x] **P3.0** — Confirm branch and create Phase 3 tracker *(this file)*
- [x] **P3.1** — Certificate format library (`@repo/beap-cert`: types, canonical serialization, Ed25519 sign/verify, hash helpers)
- [x] **P3.2** — Certifier and verifier role stubs + dispatcher routing (real `/certify` and `/verify-cert` in P3.4 and P3.6)
- [x] **P3.3** — REMOTE_EDGE pod manifest (ingestor → validator → depackager → certifier; no sealer; uid 10104 certifier)
- [ ] **P3.4** — Certifier role `/certify` HTTP server (Ed25519 signing; env validation; depackager → certifier routing)
- [ ] **P3.5** — Keycloak attestation flow (`sso_attestation` JWT; resolve Decision 6)
- [ ] **P3.6** — Verifier role container (`/verify-cert` on LOCAL_VERIFY)
- [ ] **P3.7** — LOCAL_VERIFY pod manifest (ingestor → verifier → validator → depackager → sealer)
- [ ] **P3.8** — Edge key lifecycle in Electron
- [ ] **P3.9** — pod-client edge routing
- [ ] **P3.10** — LOCAL_VERIFY ingestion wiring + E2E manual round-trip

---

## Status summary

| Step | State | Commit |
|------|-------|--------|
| P3.0 | ✅ done | P3.0: phase 3 tracker |
| P3.1 | ✅ done | P3.1: beap-cert library for certificate format and signing |
| P3.2 | ✅ done | P3.2: add certifier and verifier role stubs to dispatcher |
| P3.3 | ✅ done | P3.3: REMOTE_EDGE pod manifest (no sealer; certifier holds Ed25519 key) |
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

### P3.1

- **New package:** `packages/beap-cert/` (`@repo/beap-cert`) — pure crypto + serialization; no HTTP, no key storage, no SSO attestation verification.
- **Types:** `EdgeCertificate`, `UnsignedCertificate` match strategy §2.2 field-for-field.
- **Canonical serialization:** `fast-json-stable-stringify` for deterministic key ordering; `canonicalizeForSigning()` returns UTF-8 bytes (no trailing newline).
- **Signing / verification:** `@noble/curves/ed25519`; signature format `ed25519:<hex>` (64-byte sig → 128 hex chars).
- **Hash helpers:** `sha256Hex`, `packageHash`, `capsuleCanonicalHash`, `validationResultDigest` — all return `sha256:<lowercase-hex>`.
- **Tests:** 12 pass (round-trip sign/verify, wrong key, tamper, canonical stability, hash fixtures).
- **Not imported by pod yet** — certifier (P3.4) and verifier (P3.6) will consume this package.

### P3.2

- **New stubs:** `src/roles/certifier.ts` (logs `role: certifier`, exits 0 after 5 s), `src/roles/verifier.ts` (logs `role: verifier`, exits 0 immediately).
- **entrypoint.sh:** routes `BEAP_ROLE=certifier|verifier` to compiled role binaries.
- **Containerfile:** unchanged except comments — single image uid 10100 remains; per-role uids 10100..10105 are assigned in pod manifests (P3.3/P3.5), not in the image.
- **tsconfig:** no change — `src/**/*.ts` already compiles new role files.
- **Verification:** `pnpm --filter @repo/beap-pod build` passes; node dispatch of certifier/verifier stubs confirmed on Windows. `podman build/run` not available on this host — CI/Linux manual check pending.

### P3.3

- **New manifest:** `pod-remote-edge.yaml` — four containers (ingestor 10100, validator 10101, depackager 10102, certifier 10104). No sealer. Only :18100 exposed on host.
- **Certifier env:** `EDGE_PRIVATE_KEY_HEX`, `EDGE_POD_ID`, `SSO_ATTESTATION_JWT`, `CERT_TTL_SECONDS` (default 86400 via envsubst export). Startup validation deferred to P3.4.
- **Depackager:** `CERTIFIER_BASE=http://127.0.0.1:18104`, `POD_MODE=REMOTE_EDGE`; routing to certifier wired in P3.4 (same binary as LOCAL_HOST).
- **Seccomp:** `seccomp/certifier.json` copied from sealer profile; install as `beap-certifier.json`. Same syscall allowlist; documented as independently versioned.
- **Containerfile:** unchanged (single image uid 10100; per-role uids in manifest only).
- **Smoke:** `scripts/remote-edge-smoke.sh` — dry-run, keygen, stub JWT, ingest POST, cert verify via `@repo/beap-cert`; exits with `TODO P3.4` until certifier HTTP lands.
- **README:** new §"Running a REMOTE_EDGE pod" with manual secret generation and `podman play kube` command.

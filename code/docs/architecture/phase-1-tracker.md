# Phase 1 Tracker — Pod Becomes Hot Path

Branch: `phase-1/pod-becomes-hot-path`  
Strategy ref: `docs/architecture/beap-high-assurance-strategy.md`  
Audit ref: `docs/architecture/beap-ingestor-audit-2026-05-24.md`

---

## Steps

- [x] **P1.0** — Branch and tracker *(this file)*
- [ ] **P1.1** — Pin base image digest; add `test:ci` to beap-pod
- [ ] **P1.2** — Add CI job to build and smoke-test the pod image
- [ ] **P1.3** — Enforce `MAX_STRING_LENGTH` and `ALLOWED_CONTENT_TYPES` in the ingestor
- [ ] **P1.4** — Implement pod `/depackage` with injectable key material
- [ ] **P1.5** — Extract depackaging core to a standalone Node-compatible package
- [ ] **P1.6** — Add `PodClient` module to the Electron app
- [ ] **P1.7** — Add pod URL config and readiness gate to Electron
- [ ] **P1.8** — Route structural validation through the pod (Linux only)
- [ ] **P1.9** — Route depackaging through the pod (Linux only)
- [ ] **P1.10** — Make validator subprocess seal come from the pod (remove encrypted-variant stubs)
- [ ] **P1.11** — Add per-session auth on the pod channel
- [ ] **P1.12** — Verification pass

---

## Status summary

| Step | State | Commit |
|------|-------|--------|
| P1.0 | ✅ done | *(this commit)* |
| P1.1 | ⬜ pending | — |
| P1.2 | ⬜ pending | — |
| P1.3 | ⬜ pending | — |
| P1.4 | ⬜ pending | — |
| P1.5 | ⬜ pending | — |
| P1.6 | ⬜ pending | — |
| P1.7 | ⬜ pending | — |
| P1.8 | ⬜ pending | — |
| P1.9 | ⬜ pending | — |
| P1.10 | ⬜ pending | — |
| P1.11 | ⬜ pending | — |
| P1.12 | ⬜ pending | — |

---

## Notes & deviations

*(Record any decisions made differently from the strategy here, with rationale.)*

### P1.0

- Reference docs (`beap-high-assurance-strategy.md`, `beap-ingestor-audit-2026-05-24.md`) did not yet exist in the repo at time of branch creation. Both were committed as part of P1.0 so that all subsequent prompts can reference them by path.
- Strategy doc was synthesised from the audit findings, the described prompt sequence (P1.0–P1.12), and the stated goal ("make the multi-container pod the actual hot path for ingest/validate/depackage/seal, on Linux"). If the canonical strategy doc differs from the one committed here, update `beap-high-assurance-strategy.md` before running P1.1 and note the delta below.

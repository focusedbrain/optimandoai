# Phase 1 Tracker — Pod Becomes Hot Path

Branch: `phase-1/pod-becomes-hot-path`  
Strategy ref: `docs/architecture/beap-high-assurance-strategy.md`  
Audit ref: `docs/architecture/beap-ingestor-audit-2026-05-24.md`

---

## Steps

- [x] **P1.0** — Branch and tracker *(this file)*
- [x] **P1.1** — Single image + role dispatcher with stubs
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
| P1.1 | ✅ done | P1.1: single image + role dispatcher with stubs |
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

### P1.1

- Base image pinned: `node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293`
  (multi-arch index, pushed 2026-04-15; refresh with `podman manifest inspect docker.io/library/node:20-alpine`).
- `tsconfig.json` updated to add `"types": ["node"]`. Required because a broken `@types/fluent-ffmpeg`
  symlink in the parent-of-repo `node_modules/@types` was being picked up by TypeScript's implicit
  type auto-discovery, causing error TS2688. Pinning to `["node"]` is correct for an isolated server
  package anyway.
- `HEALTHCHECK` omitted from Containerfile. Role stubs have no HTTP server in P1.1. Liveness /
  readiness probes are already defined per-container in `pod.yaml`. A per-role `HEALTHCHECK` will be
  added once the real role HTTP servers are implemented in P1.3–P1.6.
- `CMD` replaced by `ENTRYPOINT ["/app/entrypoint.sh"]`. The old `CMD ["node", "packages/beap-pod/dist/index.js"]`
  no longer applies; direct invocation of the single-server is replaced by the role dispatcher.
  The old `src/index.ts` / server code is untouched and still compiles to `dist/index.js`.
- `docker:build` script updated to `podman build -t beap-components:dev` (renamed from `wrdesk-pod`).
- Non-root UID/GID set to 10100 (Strategy §1.3).
- Role stubs: `src/roles/{ingestor,validator,depackager,sealer}.ts` — log role name, handle SIGTERM,
  exit 0 after 5 s. Real logic wired in P1.3–P1.6.

- Reference docs (`beap-high-assurance-strategy.md`, `beap-ingestor-audit-2026-05-24.md`) did not yet exist in the repo at time of branch creation. Both were committed as part of P1.0 so that all subsequent prompts can reference them by path.
- Strategy doc was synthesised from the audit findings, the described prompt sequence (P1.0–P1.12), and the stated goal ("make the multi-container pod the actual hot path for ingest/validate/depackage/seal, on Linux"). If the canonical strategy doc differs from the one committed here, update `beap-high-assurance-strategy.md` before running P1.1 and note the delta below.

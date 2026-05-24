# Phase 1 Tracker — Pod Becomes Hot Path

Branch: `phase-1/pod-becomes-hot-path`  
Strategy ref: `docs/architecture/beap-high-assurance-strategy.md`  
Audit ref: `docs/architecture/beap-ingestor-audit-2026-05-24.md`

---

## Steps

- [x] **P1.0** — Branch and tracker *(this file)*
- [x] **P1.1** — Single image + role dispatcher with stubs
- [x] **P1.2** — Inter-container X-Pod-Auth shared helper
- [x] **P1.3** — Ingestor role container
- [x] **P1.4** — Validator role container
- [x] **P1.5** — Depackager role container (qBEAP/pBEAP decrypt, 6-gate pipeline, HTML sanitization, wall-clock timeout)
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
| P1.2 | ✅ done | P1.2: inter-container X-Pod-Auth helper |
| P1.3 | ✅ done | P1.3: ingestor role container |
| P1.4 | ✅ done | P1.4: validator role container, close MAX_STRING_LENGTH/ALLOWED_CONTENT_TYPES gaps |
| P1.5 | ✅ done | P1.5: depackager role container with HTML sanitization and timeout |
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

### P1.5

- Strategy described P1.5 as "Extract depackaging core to a standalone Node-compatible package". The
  explicit P1.5 prompt redefines this step as the full depackager **role container** (HTTP server +
  ported crypto + 6-gate pipeline + HTML sanitization + wall-clock timeout); tracker updated.
- **New files:**
  - `packages/beap-pod/src/roles/depackagePipeline.ts` — crypto helpers + 6-gate pipeline
    (ported; do not import from Electron or extension sources). Exports `runDepackagePipeline`,
    `hkdfDerive`, `aesGcmDecrypt`, `computeEnvelopeAadBytes`, `fromBase64`, `toBase64` for tests.
  - `packages/beap-pod/src/roles/depackager.ts` — HTTP server (replaces stub). Ports logic from
    `decryptQBeapPackage.ts` + `depackagingPipeline.ts` + `beapEnvelopeAad.ts` (all cited inline).
  - `packages/beap-pod/src/roles/__tests__/depackager.test.ts` — 10 tests.
- **New dependencies added to `beap-pod`:**
  - `sanitize-html` + `@types/sanitize-html` — HTML sanitization with documented strict allow-list.
  - `@noble/curves` — X25519 ECDH (`x25519.getSharedSecret`).
  - `@noble/post-quantum` — ML-KEM-768 (`ml_kem768.decapsulate`) for hybrid qBEAP packages.
- **Pipeline deviations from source code:**
  - No Electron DB / `getHandshakeRecord`; receiver X25519 private key injected via config (env var
    `BEAP_LOCAL_X25519_PRIV_B64` in production, `localX25519PrivB64` in tests).
  - Gate 1: structural-only (no `knownSenders` matching — sender identity pinning deferred to P1.11).
  - Gate 5: skipped by default (`skipSignatureVerification: true`) — Ed25519 verify wired in P1.11.
  - HKDF labels, hybrid secret order (ML-KEM ∥ X25519), AAD computation match the Electron and
    extension implementations exactly (verified in the round-trip test).
- **HTML sanitization allow-list** (`HTML_SANITIZE_OPTIONS` in `depackager.ts`):
  - `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`, `<form>`, `<input>` not listed → stripped.
  - No `on*` event handlers (not in `allowedAttributes` → stripped by sanitize-html).
  - `allowedSchemes: ['http', 'https', 'mailto']` — javascript: and data: stripped from href/src.
  - `allowedSchemesByTag.img: ['http', 'https']` — data: URLs in `<img src>` stripped.
  - No `style=` attribute (CSS injection prevention).
- **Wall-clock timeout:** `AbortController` + `setTimeout(cfg.timeoutMs)` wraps the sealer `fetch`
  call. Default 5 s, configurable via `DEPACKAGER_TIMEOUT_MS` env / `timeoutMs` config. Returns 504
  with `{ code: 'DEPACKAGER_TIMEOUT' }`. The mock in the test listens on the AbortSignal (mirroring
  real `fetch` behaviour), ensuring the 504 fires at ~150 ms in the test.
- **`/ready` endpoint** returns 503 when `localX25519PrivB64` is not configured.
- **Test coverage (10 tests):**
  1. Round-trip qBEAP — deterministic X25519 keys, AES-256-GCM encrypt in test, depackager decrypts.
  2. Malformed structural — missing header → 422 from `validateBeapStructure`.
  3. Corrupted ciphertext — passes structural but fails gate 4 (AES-GCM auth tag) → 422 gate=4.
  4. HTML sanitization unit — `sanitizeBeapBody` strips `<script>`, `onclick`, `javascript:`, `data:`.
  5. HTML sanitization E2E — pBEAP package with dirty body; sanitized body forwarded to sealer.
  6. Wall-clock timeout — 504 within 2 s with `timeoutMs: 150`.
  7. Auth enforcement — 401 without X-Pod-Auth.
  8. `/health` — 200.
  9. `/ready` with key — 200.
  10. `/ready` without key — 503.
- **Verification:** 43/43 beap-pod tests pass; 60/60 ingestion-core tests pass (regression clean).

### P1.4

- Strategy listed P1.4 as "Implement pod `/depackage` with injectable key material". The explicit P1.4
  prompt redefines this step as the full validator role container (HTTP server) with the two audit-gap
  closures; tracker description updated.
- Two new `ValidationReasonCode` values added to `ingestion-core/src/types.ts`:
  `PAYLOAD_STRING_TOO_LONG` and `CONTENT_TYPE_NOT_ALLOWED`. These are stable string literals so
  Electron and UI code can switch on them without a future rename.
- `findOversizedString(value, maxLen)` helper added to `ingestion-core/src/stringLengthCheck.ts`
  and exported from `@repo/ingestion-core`. The validator role calls it on `candidate.raw_payload`
  before delegating to `validateCapsule()`, closing the MAX_STRING_LENGTH audit gap.
- `ALLOWED_CONTENT_TYPES` enforcement lives in the validator role (strategy §1.3: "canonical rules
  in the validator"). The check normalises MIME type by stripping parameters (`text/plain; charset=…`
  → `text/plain`). Absent `mime_type` is allowed (permissive for back-compat with callers that
  don't set it).
- `createValidatorServer(secret, config?)` accepts injectable `authedFetch` (for tests) and
  `maxStringLength` (for tests with smaller limits). Production uses `podAuthFetch(secret)` and
  `INGESTION_CONSTANTS.MAX_STRING_LENGTH` (5 MiB).
- Auth gate uses `res.once('finish', …)` + `next()` pattern to safely await the synchronous
  `createPodAuthMiddleware` without leaking into subsequent handler logic.
- Message-package capsules (`capsule_type === 'message_package'`) are forwarded to the depackager
  stub at `http://127.0.0.1:18102/depackage`; handshake capsules return directly with
  `needs_depackaging: false`.
- 8 tests across 6 suites (valid handshake, oversized string, disallowed MIME, message-package
  forward, pod-auth ×2, /health + /ready); 33/33 beap-pod tests pass in 463 ms.
- `@repo/ingestion-core` regression: 60/60 tests still pass after types and helper additions.

### P1.3

- Strategy listed P1.3 as "Enforce MAX_STRING_LENGTH / ALLOWED_CONTENT_TYPES". The explicit P1.3 prompt
  replaces that scope with the full ingestor role container; tracker description updated.
- Added `@repo/ingestion-core: workspace:*` to `dependencies` in `beap-pod/package.json`.
- Containerfile updated: builder now copies `packages/ingestion-core/`, builds it before `beap-pod`,
  and the runtime stage copies its dist/ so the symlink in `node_modules/@repo/ingestion-core`
  resolves correctly inside the container.
- `createIngestorServer(secret, config?)` accepts injectable `authedFetch` for tests; production
  defaults to `podAuthFetch(secret)`.
- `Connection: close` added to 413 responses. Without it, a client that declared a large
  `Content-Length` but didn't send the full body caused a ~4 s connection-drain wait.
- 7 tests added across 5 suites (happy path, validator rejection, oversized body ×2, /ready ×2,
  /health); 25/25 pass in 434 ms total.

### P1.2

- Strategy doc listed P1.2 as "CI job". The explicit P1.2 prompt redefines it as the inter-container
  auth helper; tracker description updated to match.
- Header name: `X-Pod-Auth` (per prompt). Strategy §1.11 says `Authorization: Bearer`; that wording
  applies to the P1.11 session-auth wiring. P1.2 establishes the helper — P1.11 may rename the header
  if needed.
- Constant-time comparison: HMAC-SHA256 with a per-process random key normalises both operands to
  32 bytes before calling `timingSafeEqual`, preventing length-leak side-channels without a separate
  fixed-length padding scheme.
- `POD_AUTH_SECRET` appears only in `src/shared/podAuth.ts` and its test file (verified by grep).
- 9 tests added (3 middleware, 2 fetch-wrapper, 3 requirePodAuthSecret); total 18/18 pass.

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

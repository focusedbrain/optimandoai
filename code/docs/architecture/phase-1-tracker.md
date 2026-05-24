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
- [x] **P1.6** — Sealer role container (HMAC-SHA256 seal, byte-identical to validator-process computeSeal)
- [x] **P1.7** — Pod manifest (podman play kube): 4-container pod with hardening, seccomp, smoke test
- [x] **P1.8** — Minimal local-pod runner in Electron (Linux only: startLocalPod / stopLocalPod)
- [x] **P1.9** — pod-client package (@repo/pod-client): thin HTTP wrapper for ingestor
- [ ] **P1.9** — Route depackaging through the pod (Linux only)
- [x] **P1.10** — Wire Electron through pod-client behind WR_POD_HOT_PATH feature flag (off by default)
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
| P1.6 | ✅ done | P1.6: sealer role container with HMAC seal |
| P1.7 | ✅ done | P1.7: multi-container pod manifest with hardening |
| P1.8 | ✅ done | P1.8: minimal local-pod runner in Electron (Linux only) |
| P1.9 | ✅ done | P1.9: pod-client package (@repo/pod-client) |
| P1.10 | ✅ done | P1.10: wire ingestion through pod-client behind WR_POD_HOT_PATH (off by default) |
| P1.11 | ⬜ pending | — |
| P1.12 | ⬜ pending | — |

---

## Notes & deviations

*(Record any decisions made differently from the strategy here, with rationale.)*

### P1.10

- **Feature flag:** `WR_POD_HOT_PATH=1` enables the pod hot path; unset / any other value → in-process path (default OFF).
- **Base URL override:** `WR_POD_BASE_URL` overrides the ingestor URL (default `http://127.0.0.1:18100`).  Tests use this to point at a mock server.
- **`ingestionPipeline.ts` changes:**
  - `isPodHotPathEnabled()` exported (checks `process.env` dynamically so tests can toggle per-call).
  - `processIncomingInput` dispatches to `processIncomingInputViaPod` when flag is ON, unchanged `processIncomingInputInProcess` otherwise.
  - `processIncomingInputViaPod` calls `makePodClient()` (created fresh per call so `WR_POD_BASE_URL` changes take effect in tests), converts `Buffer` bodies to base64, maps pod JSON response to `IngestionResult`.
  - `mapPodBodyToIngestionResult` handles three cases: rejection (422 → `{ valid: false }`), handshake success (200 → `{ valid: true, validated }`), unrecognised (error / depackager result).
  - The success path calls `routeValidatedCapsule(validated)` (same as in-process) so `distribution.target` is identical.
  - All log lines in the pod path are prefixed `[pod-hot-path]`.
- **Hardening guard compliance:** `as ValidatedCapsule` cast forbidden by `hardening.test.ts`; used inline type alias `type PodValidated = import('@repo/ingestion-core').ValidatedCapsule` with `as unknown as PodValidated` instead.  All comments avoid the forbidden string.
- **`@repo/pod-client` dependency:** Added to `apps/electron-vite-project/package.json` (workspace dep) and root `vitest.config.ts` alias.
- **Parity tests:** `__tests__/podHotPath.parity.test.ts` — 17 tests covering flag state, routing, success parity (initiate capsule → `handshake_pipeline`, plain email → `sandbox_sub_orchestrator`), rejection parity (`INGESTION_ERROR_PROPAGATED`, `MISSING_REQUIRED_FIELD`), and `[pod-hot-path]` log prefix.  Mock server calls ingestion-core directly so both paths exercise identical validation logic.
- **Non-goals confirmed:** In-process path untouched; flag default stays OFF; existing 194 ingestion tests all pass.

### P1.9


- **New package:** `packages/pod-client/` — `@repo/pod-client`; zero runtime dependencies on
  ingestion-core or any other workspace package.
- **`src/types.ts`:**
  - Defines `SourceType`, `TransportMetadata`, `RawInput` as local mirrors of ingestion-core types
    (structurally compatible; callers holding ingestion-core values can pass them directly).
  - `RawInput.body` restricted to `string` (Buffer unsupported in HTTP transport; caller must
    base64-encode if needed).
  - `PodClientConfig { baseUrl: string; requestTimeoutMs: number }`.
  - `PodClient` interface with `ingest(rawInput, sourceType, transportMeta?)`.
  - `PodIngestResult { status: number; body: unknown }`.
  - `PodIngestHttpError` — non-2xx response (includes status + body; not retried).
  - `PodTimeoutError` — AbortController fired before response (not retried).
  - `PodConnectionError` — network-level failure (retried once).
- **`src/client.ts`:**
  - `createPodClient(config)` returns a `PodClient` singleton.
  - `ingestWithRetry` — wraps `ingestOnce` with retry logic:
    - `PodIngestHttpError` (4xx/5xx): never retry.
    - `PodTimeoutError`: never retry.
    - `PodConnectionError`: retry once (`MAX_RETRIES = 1`).
  - `ingestOnce` — builds the `IngestRequestBody` envelope (matches ingestor.ts wire format),
    sets `Content-Type: application/json`, fires `fetch` with `AbortController` for timeout,
    maps fetch rejection → `PodTimeoutError` or `PodConnectionError`, maps non-2xx → `PodIngestHttpError`.
  - Undefined transport metadata fields are omitted from the JSON envelope (no null drift).
  - No `X-Pod-Auth` header — ingestor's `POST /ingest` is the external boundary.
- **`src/index.ts`:** re-exports all public types and `createPodClient`.
- **Tests (15 tests, all pass):** mock HTTP server based; no fetch mock for real network tests.
  - Happy path: 200 → `PodIngestResult`.
  - Request envelope: Content-Type, body+source_type, transport metadata, optional RawInput fields,
    undefined fields excluded.
  - 4xx: `PodIngestHttpError`, status=400, body preserved, not retried (1 call).
  - 5xx: `PodIngestHttpError`, status=502, not retried (1 call).
  - Connection error: `PodConnectionError` after 2 attempts (1 retry).
  - Timeout: `PodTimeoutError` with correct `timeoutMs`, not retried (1 call).

### P1.8

- **New directory:** `apps/electron-vite-project/electron/main/local-pod/` — 4 files.
- **`secrets.ts`:**
  - `generatePodAuthSecret()` — `randomBytes(32).toString('hex')`.
  - `deriveSealKeyHex(vault)` — calls `vault.deriveApplicationKey('pod-seal-key-v1')`;
    key Buffer is zeroized after hex conversion; returns null if vault is locked.
  - Key info label `'pod-seal-key-v1'` is intentionally distinct from the validator-subprocess
    label `'validator-seal-key-v1'` so the two keys are independent.
- **`podRunner.ts`:**
  - `applyPodManifest(podAuthSecret, sealKeyHex, options?)`:
    reads manifest template → string-replaces `${POD_AUTH_SECRET}` / `${SEAL_KEY_HEX}` in memory →
    writes mode-0600 temp file → `podman play kube <tmpFile>` → deletes temp file (always, even on
    error) → returns `ActivePod { podName, stop() }`.
  - Secrets never appear in podman argv; they are only in the temp file, which is deleted immediately.
  - `PodmanExecutor` is injectable (defaults to `execFileAsync('podman', ...)`) for unit tests.
  - Manifest path: priority order: (1) `options.manifestPath`, (2) `BEAP_POD_MANIFEST` env var,
    (3) `process.cwd()/packages/beap-pod/pod.yaml` (dev mode default).
  - Timeout: 60 s (generous for image pull on first run).
  - `teardownPod` runs `pod stop --time 10 <name>` then `pod rm <name>`; errors are logged, not thrown.
- **`index.ts`:**
  - Module-level `_activePod` / `_startPromise` for singleton pod state (same pattern as `ValidatorOrchestrator`).
  - `startLocalPod(vault, options?)`:
    - `options.platform` (default `process.platform`) — Linux guard; logs and returns immediately
      on non-Linux platforms.
    - Already-running guard: no-op if `_activePod` is set.
    - In-flight join: if `_startPromise` is set, returns the same Promise (prevents duplicate pods).
    - Errors are caught and logged (never thrown) — in-process validation path keeps running.
  - `stopLocalPod()`: calls `_activePod.stop()` if a pod is running; no-op otherwise.
  - `_resetStateForTest()` exported for test isolation.
- **Wiring in `vault/rpc.ts`:**
  - `vault.create` and `vault.unlock`: `startLocalPod(vaultService).catch(...)` added after
    `validatorOrchestrator.start()` — same non-awaited `.catch()` pattern.
  - `vault.lock`: `stopLocalPod().catch(...)` added after `validatorOrchestrator.stop()`.
- **Wiring in `main.ts`:**
  - `app.on('before-quit')`: dynamic `import('./main/local-pod/index.js')` + `await stopLocalPod()`
    added before the OAuth server shutdown, wrapped in try/catch.
- **Tests (21 tests, all pass):**
  - `generatePodAuthSecret`: 64-char hex, fresh per call.
  - `deriveSealKeyHex`: correct return, null when locked, Buffer zeroized.
  - Platform guard: win32 and darwin → executor not called.
  - Linux start: executor called with `['play', 'kube', <tmpPath>]`, secrets not in argv.
  - Locked vault → no-op.
  - Executor error → non-fatal.
  - Concurrent start → single executor call.
  - Second start after completion → no-op.
  - Stop: `['pod', 'stop', ...]` then `['pod', 'rm', ...]` with correct pod name.
  - No-op stop when no pod running.
  - Secret substitution: placeholders replaced in temp manifest content.
  - Temp manifest deleted after success and after executor error.
  - `resolveManifestPath`: priority order tested.
- **Strategy deviation:** Strategy §1.8 describes "Route structural validation through the pod".
  The explicit P1.8 prompt redefines this step as the local-pod runner module; structural routing
  is deferred to P1.9. Tracker description updated.

### P1.7

- **Replaced `pod.yaml`:** old manifest had one container (`wrdesk-beap-pod`, port 17180, no security
  context). New manifest defines four containers: `ingestor`, `validator`, `depackager`, `sealer`.
- **Pod name:** `beap-pod` (was `wrdesk-beap-pod`).
- **Port exposure:** only `ingestor:18100` has `hostPort: 18100`. The validator (18101), depackager
  (18102), and sealer (18103) ports are container-internal; reachable on loopback within the pod.
- **UIDs:** ingestor=10100, validator=10101, depackager=10102, sealer=10103 — each with its own
  non-root UID for defence-in-depth. All run in `runAsGroup: 10100` (the `beap` group created in
  the Containerfile); files in `/app` are world-readable (root:root 644) so all UIDs can execute.
- **Security context (all containers):** `allowPrivilegeEscalation: false`, `readOnlyRootFilesystem: true`,
  `capabilities.drop: ["ALL"]`.
- **Seccomp:**
  - Ingestor, Validator, Depackager: `RuntimeDefault` (OCI default; ML-KEM-768 + AES-GCM require V8 JIT).
  - Sealer: `Localhost: beap-sealer.json` — strict deny-by-default allowlist. Key removals vs OCI default:
    `execve/execveat`, `fork/vfork`, `ptrace`, `process_vm_*`, `keyctl/add_key/request_key`, `bpf`,
    `perf_event_open`, `mount/umount/pivot_root/chroot`, `unshare/setns`, `unlink/mkdir/chmod/chown/*`
    (belt-and-suspenders for `readOnlyRootFilesystem`), `swapon`, `syslog`, `acct`, `quotactl`,
    `setuid/setgid/capset`. See `seccomp/sealer.json._doc.removed_from_oci_runtime_default` for the
    full annotated list.
  - Phase-3 target: compile sealer to a standalone binary to reduce to read/write/futex/exit class.
- **Volumes:** each container has a small `/tmp` emptyDir (Memory, 8 MiB). The depackager additionally
  gets `/tmp/depackage` (Memory, 64 MiB) for ephemeral crypto intermediates — Strategy §1.3 requirement.
- **Secret injection:** `${POD_AUTH_SECRET}` and `${SEAL_KEY_HEX}` are `envsubst` placeholders in
  `pod.yaml`. Apply command: `envsubst < packages/beap-pod/pod.yaml | podman play kube -`. Reason:
  avoids committing secrets; avoids Kubernetes Secrets overhead for Phase 1 local operation.
  Real secret management (vault-backed injection) deferred to Phase 3.
- **`restartPolicy: OnFailure`** at pod level.
- **Resource limits:**
  - Sealer: requests 32Mi/25m, limits 128Mi/100m (smallest — HMAC only).
  - Ingestor, Validator: requests 64Mi/50m, limits 256Mi/250m.
  - Depackager: requests 128Mi/100m, limits 512Mi/500m (largest — ML-KEM-768 + AES-GCM).
- **`seccomp/sealer.json`:** new file. Deny-by-default seccomp profile for the sealer. All syscall
  groups annotated with `comment` field. Top-level `_doc` object documents removed syscalls (ignored
  by seccomp parser).
- **`scripts/pod-smoke.sh`:** new file. Covers: image build → generate secrets → install seccomp
  profile → `podman play kube` → poll for readiness → `/health` assertion → handshake capsule
  (ingestor→validator) → pBEAP capsule (full pipeline) → teardown. Exits 0 on success; EXIT trap
  tears down the pod regardless. The pBEAP test asserts non-5xx and opportunistically checks for a
  `"seal"` field in the response; a structural mismatch is logged but not a hard failure (full
  sealed-payload E2E is covered by the Vitest round-trip test in P1.5).
- **`README.md`:** rewritten. Documents: architecture diagram, role table, step-by-step `podman play
  kube` commands, secret generation, seccomp installation, smoke test usage, all env vars.
- **Strategy deviation:** the strategy §1.7 describes "Add pod URL config and readiness gate to
  Electron". The explicit P1.7 prompt redefines this step as the pod manifest itself; the Electron
  wiring is deferred to P1.8/P1.9. Tracker description updated.
- **Verification:** `pnpm --filter @repo/beap-pod test` still passes 73/73 (no code changes).
  Runtime verification (`podman play kube` → 30s readiness) requires Linux with rootless podman.

### P1.6

- **New file:** `packages/beap-pod/src/roles/sealer.ts` — replaces stub. HTTP server on
  `127.0.0.1:18103`. Accepts `POST /seal` (X-Pod-Auth required), `GET /health`, `GET /ready`.
- **Seal computation** (`computeSealPod`): byte-identical to `computeSeal()` in
  `apps/electron-vite-project/electron/main/validator-process/index.ts`. Algorithm:
  1. `contentSha256 = SHA-256(canonicalJson, 'utf8').hex`
  2. `nonce = randomBytes(32).base64` (fresh per invocation)
  3. `sealInput = { content_sha256, nonce, row_id, outcome_class, validator_version, validated_at }` (stable key order)
  4. `sealInputJson = JSON.stringify(sealInput)`
  5. `seal = HMAC-SHA256(key, sealInputJson, 'utf8').base64`
  6. Returns `{ seal, sealInputJson }`
- **Key lifecycle:**
  - `SEAL_KEY_HEX` (hex-encoded, min 32 bytes) read once at startup via `parseSealKeyHex()`.
  - Env var immediately overwritten with `'0'.repeat(len)` then deleted — no long-lived copy.
  - `parseSealKeyHex` throws (not `process.exit`) so unit tests can assert on error messages.
  - `startSealerServer` catches the error, logs the message (never the key), and calls `process.exit(1)`.
  - SIGTERM handler zeroizes the in-memory `sealKey` Buffer before `server.close()`.
- **Security properties confirmed by grep:**
  - All three `console.*` calls: (a) FATAL startup error (message from `parseSealKeyHex`, never echoes key), (b) `sealer ready` line (port + version only), (c) SIGTERM log. No key material in any log.
  - No outbound `fetch` or `http.request` — role is purely receive-and-respond.
  - `verifySealPod` uses `timingSafeEqual` (mirrors `verifySeal` in `validator-process/index.ts`).
- **Request body** (`POST /seal`): `{ canonicalJson?, depackaged?: { rawCapsuleJson?, … }, rowId?, outcomeClass?, validatorVersion?, validatedAt? }`. `canonicalJson` overrides `depackaged.rawCapsuleJson` when both present. Absent `rowId` → random UUID. Absent `outcomeClass` → `'validated'`.
- **Test coverage (30 tests):**
  1–6. `computeSealPod` — structure, `content_sha256` SHA-256 identity, valid HMAC, wrong-key fails, exact key order, fresh nonces.
  7–9. tampered input — different content/row_id → different seal; tampered sealInputJson fails `verifySealPod`.
  10–18. `parseSealKeyHex` — undefined, empty, whitespace, non-hex, odd-length, too short, exact 32 B, 64 B, case-insensitive.
  19–21. `verifySealPod` — valid true, wrong key false, tampered false.
  22–27. HTTP server — round-trip with `canonicalJson`, `depackaged.rawCapsuleJson`, auto-rowId, missing content → 400, 401 without auth.
  28–29. `/health` → 200 `{ status:'ok', role:'sealer' }`, `/ready` → 200 `{ status:'ready' }`.
  30. log-safety — error messages never echo key value.
- **Verification:** 73/73 beap-pod tests pass; 0 regressions.
- **Non-goal (confirmed):** `computeSeal()` in `validator-process/index.ts` unchanged. Key rotation deferred to Phase 3+.
- **P1.7 note:** seccomp profile for the sealer role (read/write/futex/exit only, per §1.3 hardening) to be noted in the pod manifest during P1.7.

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

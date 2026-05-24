# BEAP High-Assurance Pod Strategy

**Status:** Phase 1 in progress (see `docs/architecture/phase-1-tracker.md`)  
**Goal:** Make the `beap-pod` container the actual hot path for ingest, validate, depackage, and seal — on Linux — replacing the current in-process and extension-sandbox paths.

---

## Background

The audit (`docs/architecture/beap-ingestor-audit-2026-05-24.md`) established the following verdict:

> The ingestor/validator/depackager **IS NOT** isolated in a podman container today.

Key findings that drive this strategy:

1. `packages/beap-pod/` has a Containerfile, a pod manifest, a structural validator, and an HTTP server, but **Electron never calls it**.
2. Production ingest/validate runs in the Electron main process (or a forked child of it). Depackaging runs in the Chromium extension sandbox and/or the main process.
3. Pod `/depackage` returns 501. Pod is not built in CI. The `POD_DEPLOYMENT_TRACE.md` doc describing it as missing is stale for some items and accurate for others.
4. The validator subprocess (`child_process.fork`) gives process isolation but not OS-level namespace isolation.
5. Multiple blockers prevent a remote-VM deployment: local vault VMK coupling, `app.getPath('userData')` paths, Chromium extension deps in the depackager, no pod URL config surface.

---

## Strategy: Phase 1 — Pod Becomes Hot Path (Linux)

Phase 1 makes the pod the mandatory first stop for every incoming message on Linux. The Electron app becomes a **thin client** for pod operations it currently does inline.

### Out of scope for Phase 1

- Windows / macOS pod deployment (Phase 2).
- Remote-VM / cloud-tier wizard (Phase 3).
- Per-message SSO-bound certificate (Phase 4).
- AI phishing/scam scoring (Phase 5).
- Self-healing loop (Phase 6).

### Phase 1 design principles

1. **Pod is the trust boundary, not a filter.** No message enters the handshake layer without a pod-issued receipt.
2. **Fail closed.** If the pod is unreachable, ingest returns an error — never falls back to in-process validate.
3. **One pod image, parameterized by config.** Local (Podman rootless) and remote (hosted VM) are the same image with different env vars.
4. **No Electron APIs in pod.** Pod is a pure Node.js HTTP server; zero Electron, SQLite, or chrome.* imports.
5. **Seal key injection.** The vault VMK-derived seal key is sent to the pod per-session over a mTLS-protected local socket (or env for local dev). The pod never stores it beyond the session.
6. **CI builds and tests the pod image.** The GitHub Actions workflow builds the image and smoke-tests `/health` and `/validate` on every PR.

---

## Phase 1 prompt sequence (P1.0 – P1.12)

### P1.0 — Branch and tracker
Create `phase-1/pod-becomes-hot-path` branch. Create this tracker file.

### P1.1 — Pin the base image and add `test:ci` to beap-pod
- Pin `node:20-alpine` to a digest in `Containerfile`.
- Add `"test:ci": "vitest run --reporter=verbose"` to `packages/beap-pod/package.json`.
- Verify `pnpm -r --if-present run test:ci` picks up the pod tests in CI.

### P1.2 — Add CI job to build and smoke-test the pod image
- Add a `pod_build` job to `.github/workflows/tests.yml`.
- Steps: checkout → `podman build -t wrdesk-pod -f packages/beap-pod/Containerfile .` → `podman run --rm -p 17180:17180 -d wrdesk-pod` → `curl /health`.
- Fail the job if `/health` does not return `{ status: 'ok' }`.

### P1.3 — Enforce `MAX_STRING_LENGTH` and `ALLOWED_CONTENT_TYPES` in the ingestor
- Close the two documented-but-not-enforced gaps in `packages/ingestion-core/src/ingestor.ts`.
- Add tests for both limits.

### P1.4 — Implement pod `/depackage` with injectable key material
- Wire the `/depackage` endpoint in `packages/beap-pod/src/podServer.ts` (remove the 501 stub).
- Accept `{ rawBeapJson, keys: { x25519PrivateKey, signingKey } }` in the request body.
- Call the existing structural validator first; on pass, run a new standalone depackage module (see P1.5).
- Return `{ valid, depackaged, seal, errors }`.

### P1.5 — Extract the depackaging core to a standalone Node-compatible module
- Create `packages/beap-depackager/` (zero chrome.* deps, zero Electron deps).
- Move/re-export the pure-Node-compatible parts of `depackagingPipeline.ts`, `beapDecrypt.ts`, `beapCrypto.ts` into it.
- Inject key storage via a `KeyProvider` interface (replaces `chrome.storage.local` / `localStorage` calls).
- Add unit tests.

### P1.6 — Add a `PodClient` module to the Electron app
- Create `apps/electron-vite-project/electron/main/pod/podClient.ts`.
- Wraps `fetch` calls to the configured pod URL (`http://127.0.0.1:17180` default).
- Methods: `validateStructure(rawJson)`, `depackage(rawJson, keys)`, `health()`.
- Throws `PodUnavailableError` (never falls back silently).

### P1.7 — Add pod URL config and readiness gate to Electron
- Add `POD_URL` to the app's settings surface.
- Add a `podReadinessCheck()` helper that calls `podClient.health()` and surfaces the result to the user.
- Wire `ensureValidatorAndSealedStorageReady()` to also check pod readiness on Linux.

### P1.8 — Route structural validation through the pod
- In `processBeapPackageInline()` and `messageRouter.ts`, before depackaging, call `podClient.validateStructure()`.
- If the pod rejects, treat as quarantine — same path as existing validator rejection.
- Guard behind `process.platform === 'linux'` for Phase 1 scope.

### P1.9 — Route depackaging through the pod
- Replace the inline `decryptQBeapPackage()` call with `podClient.depackage()` on Linux.
- Key material: derive from vault VMK and pass in the request body (never stored in pod).
- Remove the now-pod-side logic from the Electron main process; keep extension sandbox path for non-Linux.

### P1.10 — Make the validator subprocess seal come from the pod
- Wire the `qbeap_encrypted` and `pbeap` variants in `validator-process/index.ts` so they request depackage+seal from the pod (via a new IPC message type).
- Remove the `ARTEFACT_UNKNOWN_KEY` stub paths.

### P1.11 — Add auth on the pod channel
- Add a per-session shared secret (32-byte random) negotiated at app start between Electron and the local pod.
- All pod HTTP requests carry `Authorization: Bearer <secret>`.
- Pod rejects requests without a valid token.
- This is the minimal auth for local operation; mTLS comes in Phase 3 for remote.

### P1.12 — Verification pass
- `git branch --show-current` → `phase-1/pod-becomes-hot-path`
- `pnpm -r --if-present run test:ci` → all pass
- Pod CI job passes (build + smoke test)
- `grep -r "decryptQBeapPackage" apps/electron-vite-project/electron/main | grep -v test` → zero non-test callers (on Linux path)
- Manual smoke: start local podman pod, send a test BEAP message, confirm sealed inbox row appears

---

## Risks accepted in Phase 1

| Risk | Mitigation |
|------|-----------|
| Key material in HTTP request body (local loopback) | Per-session auth token; loopback only; mTLS in Phase 3 |
| Pod process not restarted on crash | Electron detects `PodUnavailableError` and surfaces it; auto-restart out of scope for Phase 1 |
| Windows/macOS still use in-process path | `process.platform === 'linux'` guard; no regression for those platforms |
| Extension sandbox depackager still used for non-Linux | Acceptable for Phase 1 scope |

---

## Deferred items

- Windows/macOS pod deployment
- Remote-VM / cloud-tier pod + redirect pipeline
- Per-message SSO-bound certificate (compliance artefact)
- AI phishing/scam scoring
- Self-healing loop with auto-pod-restart
- Rootless Podman quadlet / systemd unit generation
- Cap-drop / seccomp / AppArmor profiles for pod

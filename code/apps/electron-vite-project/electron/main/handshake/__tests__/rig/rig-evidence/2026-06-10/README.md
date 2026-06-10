# Prompt 5 session record — 2026-06-10

**Sessions:**

| Session | Machine | Result |
|---|---|---|
| Dev-box (Windows) | `f9106441` → code only | Part C code tests; Parts A/B/C live NOT RUN |
| **Rig (mini-PC)** | **`643609d4`** | **Pre-flight PARTIAL — halted on `/dev/vhost-vsock`; no live A/B/C proof** |

**Branch:** `feature/layered-sandbox`  
**HEAD (rig):** `643609d47534fcb3e31d29d3f2992f7ea742a003`

---

## Rig session summary (mini-PC)

| Part | Description | Result |
|---|---|---|
| **Step 0** | Sync + HEAD | **PASS** — `643609d4` matches Windows push |
| **Step 1 pre-flight** | kvm, vhost-vsock, rebuild, bundle guard | **PARTIAL** — kvm OK; **vhost-vsock FAIL**; build + `E_IMAGE_BUNDLE_MISMATCH` OK |
| **Part A** | Build C final leg — depackage-email through crosvm microVM | **NOT RUN** — vhost-vsock blocked; 3/4 microVM email rig tests skipped |
| **Part B code** | `fetchOpaque` / `deliverToHost` wiring | **NOT DONE** — stubs remain; deliver needs host-side `/beap/ingest` route (report-first) |
| **Part B live** | Sandbox read-client fetch → host inbox | **NOT RUN** — vhost-vsock + stub wiring + read-client consent |
| **Part C code** | `outlookRfc822Fidelity.test.ts` | **PASS** — 12 pass, 4 rig-skip (unchanged) |
| **Part C live** | RIG-1..4 vs real Graph | **NOT RUN** — no live account this session |

**Verdict:** Fail-closed. No hardware or live-account leg was simulated as passed. Operator must restore vhost-vsock ACL before Part A can proceed.

See `PREFLIGHT.md` for operator fix commands and test output.

---

## Part C code-testable results (unchanged from Windows session)

**File:** `email/__tests__/outlookRfc822Fidelity.test.ts`  
**Run:** 12 passed, 4 skipped (RIG-1..4), 0 failed.

| Test | Result |
|---|---|
| Tests 1–8, fail-closed, throttle smoke | PASS |
| RIG-1 Mail.Read / `$value` no 403 | **SKIP (rig)** |
| RIG-2 byte-identity vs original MIME | **SKIP (rig)** |
| RIG-3 binary attachment roundtrip | **SKIP (rig)** |
| RIG-4 429 Retry-After pacing | **SKIP (rig)** |

`WRDESK_OUTLOOK_OPAQUE_INPUT` remains off-by-default. `OutlookOpaqueUnprovenError` stays in place.

---

## INV-5 check

No OAuth tokens, email content, or `p2p_auth_token` values in this directory.

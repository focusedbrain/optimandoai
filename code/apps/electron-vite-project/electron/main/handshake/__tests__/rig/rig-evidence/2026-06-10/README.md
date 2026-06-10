# Prompt 5 session record — 2026-06-10

**Sessions:**

| Session | Machine | Result |
|---|---|---|
| Dev-box (Windows) | `f9106441` → code only | Part C code tests; Parts A/B/C live NOT RUN |
| **Rig (mini-PC) — halted** | **`643609d4`** | **Pre-flight PARTIAL — halted on `/dev/vhost-vsock`** |
| **Rig (mini-PC) — resumed** | **`c052051d`** | **vhost-vsock green; Part A PROVEN; Part B wired; Part C rig bodies implemented** |

**Branch:** `feature/layered-sandbox`  
**HEAD (rig, session 1):** `643609d47534fcb3e31d29d3f2992f7ea742a003`  
**HEAD (rig, session 2):** `c052051da12d622006f42ddc2f78e3a7519e5733` → updated by this session

---

## Rig session 2 summary (mini-PC, vhost-vsock verified green)

| Part | Description | Result |
|---|---|---|
| **vhost-vsock** | Re-verified after operator fix | **GREEN** — `test -r/w /dev/vhost-vsock` passes |
| **MicroVM rig** | `crosvmProvider.rig.test.ts`, `dispatcher.microvm.email.rig.test.ts`, `dispatcher.microvm.rig.test.ts` | **PASS — 11/11** |
| **Part A** | Build C final leg: `loopbackHttp.email.rig.test.ts` | **PROVEN — 3/3 pass** (see below) |
| **Part B code** | `fetchOpaqueViaOutlook`, `sandboxEmailDelivery.ts`, `b2LiveIngestion.rig.test.ts` | **WIRED** — tripwire 1/1; live skips (awaiting read-client consent) |
| **Part C code** | RIG-1..4 test bodies implemented (were stubs) | **IMPLEMENTED** — 12 pass, 4 skip (awaiting live account) |

---

## Part A proof (Build C final leg)

**File:** `critical-jobs/remote/__tests__/loopbackHttp.email.rig.test.ts`  
**Run:** 3/3 passed on rig.

| Test | Result | Key assertion |
|---|---|---|
| plain mail: workstation→RemoteHandshake→HTTP→microVM | **PASS** | `flushed=per-action` (microVM); sender verify OK; overlay nuked |
| carrier mail: opaque package round-trips byte-exact | **PASS** | `flushed=per-action`; carrier bytes unchanged |
| wrong Bearer token → auth gate | **PASS** | `E_REMOTE_PROTOCOL` |

**Configuration run:** single box, two in-process dispatcher instances, real localhost HTTP socket.

**Proof chain:**
- `meta.executorId === 'remote-handshake'` → workstation used the remote channel
- `meta.flushed === 'per-action'` → receiver's microVM executor ran (only MicroVMExecutor sets `per-action`; InProcessExecutor returns `none`)
- `res.ok === true` → sender-side `verifyDepackageEmailResult` passed (Ed25519 signature + safe-text re-validation)
- `overlay dir empty after test` → crosvm overlay created and nuked per-action
- Receiver CRITICAL_JOB log confirms: `executor=microvm ok=true flushed=per-action`

**NOTED SCOPE:** two-process cross-machine proof (actual WAN session with physical device separation) is still deferred to the CROSS_MACHINE_RUNBOOK. This single-box proof establishes the full protocol stack is correct.

---

## Part B status

**Implemented (this session):**
- `email/sandboxEmailFetch.ts` — `fetchOpaqueViaOutlook`: Outlook Graph `/$value` fetch with read-scoped token
- `critical-jobs/remote/sandboxEmailDelivery.ts` — `sandbox_email_delivery` RPC wire type + host handler
- `p2pServer.ts` — wired `tryHandleSandboxEmailDelivery` into the `/beap/ingest` dispatch chain
- `email/__tests__/b2LiveIngestion.rig.test.ts` — 1/1 tripwire pass, live suite skips

**Awaiting operator action:**
1. Set `WRDESK_PART_B_ACCOUNT_ID=<outlook-account-id>` on the sandbox node
2. Run `connectReadClient({ accountId, provider: 'microsoft365', role: 'read', email: ... })` to store the read-scoped token in `roleScopedTokenStore`
3. Re-run `b2LiveIngestion.rig.test.ts` — the live suite will unskip and fetch from the real account

**Default `deliverToHost` remains fail-closed** (multi-box P2P push via `postSandboxEmailDelivery` is implemented but the rig test injects `deliverToHost` directly for the single-box proof).

---

## Part C status

**RIG-1..4 test bodies implemented** (were stubs before this session).

Activate with:
```
WRDESK_PART_C_ACCESS_TOKEN=<live-token>
WRDESK_PART_C_MESSAGE_ID=<real-message-id>
npx vitest run .../outlookRfc822Fidelity.test.ts
```

**Gate:** If RIG-1 returns 403, STOP — do NOT flip `WRDESK_OUTLOOK_OPAQUE_INPUT` and do NOT escalate to `Mail.ReadWrite` without sign-off.

---

## Part C code-testable results

**File:** `email/__tests__/outlookRfc822Fidelity.test.ts`  
**Run:** 12 passed, 4 skipped (RIG-1..4).

| Test | Result |
|---|---|
| Tests 1–8, fail-closed, throttle smoke | PASS |
| RIG-1 Mail.Read / `$value` no 403 | **SKIP (awaiting live account)** |
| RIG-2 byte-identity vs original MIME | **SKIP (awaiting live account)** |
| RIG-3 binary attachment roundtrip | **SKIP (awaiting live account)** |
| RIG-4 429 Retry-After pacing | **SKIP (awaiting live account)** |

`WRDESK_OUTLOOK_OPAQUE_INPUT` remains off-by-default. `OutlookOpaqueUnprovenError` stays in place.

---

## INV-5 check

No OAuth tokens, email content, or `p2p_auth_token` values in this directory.

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

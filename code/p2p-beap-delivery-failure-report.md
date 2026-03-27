# P2P Delivery Failure Investigation Report

## 1. Executive Summary

**Issue (plain language).** A user-facing message states that **“Delivery is waiting before retry — try again shortly”** during an attempt to deliver BEAP content over the P2P path. In this repository, that exact string is **not** returned by a remote peer, relay, or coordination HTTP body. It is emitted **locally** by the Electron outbound capsule queue when `processOutboundQueue` runs **again** while **exponential backoff** from a **previous** send attempt has not yet elapsed.

**Operational meaning.** The delivery job is still **pending** (`queued: true`). The system is **intentionally not** issuing another HTTP POST to the coordination service or the counterparty ingestion endpoint until the cooldown window completes. This is **transient scheduling behavior** on the client, not proof that the next attempt will succeed.

**Top 3 most probable causes (for seeing this message in practice).**

| Rank | Cause | Confidence |
|------|--------|------------|
| 1 | **Backoff gate**: `processOutboundQueue` was invoked (e.g. user send, `setImmediate` after enqueue, periodic drain) **within** the required delay after a prior attempt that left `retry_count > 0` and `last_attempt_at` set. | **High** (code-proven) |
| 2 | **Prior transport failure**: An earlier attempt failed (HTTP 4xx/5xx, timeout, network error), incrementing `retry_count` and setting `last_attempt_at`; the user immediately retried or the UI surfaced the backoff message before the real error felt “resolved.” | **Medium** (typical coupling; no incident logs in scope) |
| 3 | **Coordination preflight failure** (`recordCoordinationPreflightFailure`): Missing OIDC token or coordination URL increments `retry_count` and timestamps the row—subsequent calls hit backoff the same way as HTTP failures. | **Medium** (code path exists) |

**Fastest next diagnostic actions.**

1. Inspect **`outbound_capsule_queue`** for the affected handshake: `retry_count`, `last_attempt_at`, `error`, `status` (SQLite in WR Desk / Electron DB).
2. Read **main process logs** for `[P2P-QUEUE]`, `[P2P-SEND]`, `[P2P-DEBUG]`, `[P2P] Coordination delivery` lines around the event (correlation by `handshake_id`).
3. After waiting at least one backoff interval (see §4), trigger send again or let the periodic `processOutboundQueue` run and compare **new** `error` on the row vs the backoff message.

### Minimum additional data needed

- **Runtime logs** from the Electron main process with timestamps and `handshake_id` for the failed session.
- **Row snapshot** from `outbound_capsule_queue` (or export) for the failing queue id.
- **P2P config**: `use_coordination`, `coordination_url`, and whether delivery used coordination vs direct relay HTTP.
- **Network capture** (only if transport failure persists *after* backoff): single POST to `{coordination_url}/beap/capsule` or peer `p2p_endpoint`.

### Current confidence

| Topic | Level |
|--------|--------|
| What the quoted string means **in this codebase** | **High** |
| Root cause of an **underlying** failed delivery (HTTP, auth, peer down) | **Low–Medium** without logs |
| Whether the user’s symptom is **only** backoff vs backoff **plus** real transport failure | **Medium** |

---

## 2. Scope and Inputs

### Artifacts used (evidence base)

| Artifact | Role |
|----------|------|
| `apps/electron-vite-project/electron/main/handshake/outboundQueue.ts` | **Primary:** defines the exact user-visible string and backoff logic |
| `apps/electron-vite-project/electron/main/handshake/ipc.ts` (`handshake.sendBeapViaP2P`) | Enqueue + immediate `processOutboundQueue`; surfaces `deliveryResult.error` to RPC clients |
| `apps/electron-vite-project/electron/main/handshake/p2pTransport.ts` | Coordination URL `{base}/beap/capsule`, HTTP timeout 30s |
| `apps/electron-vite-project/electron/main/p2p/__tests__/p2p-transport.test.ts` | Confirms exponential backoff prevents second attempt until delay elapses (`P2_04_exponential_backoff`) |
| `apps/extension-chromium/src/beap-messages/services/BeapPackageBuilder.ts` (`executeP2PAction`) | Extension-side mapping of RPC errors to delivery UI messages |
| `docs/beap-attachment-handling-codebase-analysis-report.md` | Context on BEAP™ builder/inbox (attachment pipeline); **not** a runtime incident log |

### Inputs **not** available in this investigation

- Production or staging **logs**, **screenshots**, **request IDs**, **packet captures**
- **Database rows** from `outbound_capsule_queue` at failure time
- **User environment** (OS build, VPN, firewall, exact WR Desk version)

### Missing but important artifacts

- Correlating **structured error** from the first failed attempt (stored in `outbound_capsule_queue.error` after a real failure)
- **OIDC token** validity / audience (`COORD_OIDC_AUDIENCE` mentioned in debug logs in `p2pTransport.ts`)

---

## 3. Term Resolution: What is “beap”?

### Candidate interpretations

| Interpretation | Supporting evidence | Contradicting evidence | Confidence |
|----------------|---------------------|-------------------------|------------|
| **A — Product / format name (BEAP™ package)** | Extension `BeapPackageBuilder.ts` builds **qBEAP** / **pBEAP** packages; filenames `*.beap`; canon references throughout. | — | **High** |
| **B — MIME / wire label** | `application/vnd.beap+json` in `ipc.ts` ingestion path. | — | **High** |
| **C — URL path segment for coordination API** | `p2pTransport.ts`: coordination posts to `{coordinationUrl}/beap/capsule`. | — | **High** |
| **D — Typo** | No evidence in codebase for an alternate spelling of the protocol name in this context. | — | **Low** (unlikely) |

### Conclusion

**“BEAP” (beap)** in this codebase is **not** an unexplained opaque token. It consistently denotes the **BEAP package protocol and product surface** (qBEAP/pBEAP), related **file extension**, **ingestion MIME type**, and the **coordination HTTP path** `/beap/capsule`. **Confidence: High.**

---

## 4. Error Interpretation

**Quoted message:**

> “Delivery is waiting before retry — try again shortly”

### What this phrasing implies (in this repository)

The only definition is in `processOutboundQueue`:

```116:127:apps/electron-vite-project/electron/main/handshake/outboundQueue.ts
    // Exponential backoff: skip if not enough time since last attempt
    const lastAttempt = db.prepare('SELECT last_attempt_at FROM outbound_capsule_queue WHERE id = ?').get(row.id) as { last_attempt_at: string | null } | undefined
    if (lastAttempt?.last_attempt_at && row.retry_count > 0) {
      const elapsed = Date.now() - Date.parse(lastAttempt.last_attempt_at)
      const required = backoffDelay(row.retry_count - 1)
      if (elapsed < required) {
        return {
          delivered: false,
          error: 'Delivery is waiting before retry — try again shortly',
          queued: true,
        }
      }
    }
```

Backoff parameters:

```21:27:apps/electron-vite-project/electron/main/handshake/outboundQueue.ts
const INITIAL_BACKOFF_MS = 5_000
const MAX_BACKOFF_MS = 5 * 60 * 1000 // 5 minutes

function backoffDelay(retryCount: number): number {
  const delay = Math.min(INITIAL_BACKOFF_MS * Math.pow(2, retryCount), MAX_BACKOFF_MS)
  return delay
}
```

| Behavior | Applies? |
|----------|----------|
| Queued but not permanently failed | **Yes** — `queued: true`; row stays `pending` |
| Transient handling / retry scheduler | **Yes** — client-side scheduler |
| Exponential backoff | **Yes** — base 5s, double each step, cap 5 min |
| Dependency wait | **No** — not a foreign dependency; purely time since `last_attempt_at` |
| Peer unavailability | **Not proven** by this message alone |
| Network / transport error | **Not proven** — no HTTP call is made when this branch runs |
| Rate limiting from server | **Not proven** — this path returns before `fetch` |
| Circuit breaker | **No** — not a distributed circuit breaker; local cooldown only |

### What this message does **not** prove

- That the **coordination server** or **peer ingestion** returned this text.
- That **NAT**, **ICE**, or **DHT** failed (those would appear in different subsystems; outbound queue uses HTTP POST).
- That the **BEAP package** payload was invalid (validation would typically fail earlier or return a different error after HTTP).
- That the queue is **stuck forever** — after `elapsed >= required`, the next `processOutboundQueue` run attempts delivery again.

### RPC surfacing

```608:617:apps/electron-vite-project/electron/main/handshake/ipc.ts
      enqueueOutboundCapsule(db, handshakeId, targetEndpoint, pkg)
      const deliveryResult = await processOutboundQueue(db, _getOidcToken)
      console.log(`[P2P-SEND] Delivery result for ${handshakeId}: ${JSON.stringify(deliveryResult)}`)
      if (!deliveryResult.delivered) {
        return {
          success: false,
          error: deliveryResult.error ?? 'Delivery failed — capsule queued for retry',
          queued: deliveryResult.queued !== false,
        }
      }
```

**Confidence:** **High** that the message is **client-originated** and **backoff-specific**.

---

## 5. Architectural Context Reconstruction

### Observed architecture (this repo)

1. **Sender (extension)** builds a BEAP **package** (`BeapPackageBuilder`) and calls **`sendBeapViaP2P(handshakeId, packageJson)`** (`handshakeRpc` → Electron IPC).
2. **Main process** validates handshake active + `p2p_endpoint`, **parses** JSON to `pkg`, **`enqueueOutboundCapsule`** → SQLite table **`outbound_capsule_queue`**.
3. **Drain:** `processOutboundQueue` picks oldest `pending` row, applies **backoff**, then:
   - **If `use_coordination`** and `getOidcToken`: **`sendCapsuleViaCoordination`** → `POST {coordination_url}/beap/capsule` with **OIDC** Bearer token.
   - **Else:** **`sendCapsuleViaHttp`** → `row.target_endpoint` with **handshake** `counterparty_p2p_token`.

```140:156:apps/electron-vite-project/electron/main/handshake/outboundQueue.ts
    if (config.use_coordination && getOidcToken) {
      const token = await getOidcToken()
      const targetUrl = config.coordination_url?.trim()
      if (!token?.trim()) {
        console.warn(`[P2P-QUEUE] Early return: No OIDC token for row ${row.id}`)
        return recordCoordinationPreflightFailure(db, row, now, 'No OIDC token — please log in')
      }
      if (!targetUrl) {
        console.warn(`[P2P-QUEUE] Early return: No coordination URL for row ${row.id}`)
        return recordCoordinationPreflightFailure(db, row, now, 'Coordination URL not configured')
      }
      result = await sendCapsuleViaCoordination(capsule, targetUrl, token)
    } else {
      const record = getHandshakeRecord(db, row.handshake_id)
      const bearerToken = record?.counterparty_p2p_token ?? null
      result = await sendCapsuleViaHttp(capsule, row.target_endpoint, row.handshake_id, bearerToken)
    }
```

4. **Success:** row `status = 'sent'`. **Failure:** increment `retry_count` (except 401), update `error`, keep `pending` until max retries → `failed`.

### Variants if deployment differs

| Variant | Description |
|---------|--------------|
| **A (Coordination)** | `use_coordination=true` — delivery is to **wrdesk coordination** URL; peer relay/registry is server-side. |
| **B (Direct HTTP)** | `use_coordination=false` — POST to peer’s **advertised ingestion URL** in `p2p_endpoint`. |
| **C (Hybrid perception)** | User says “P2P” but path is **always** coordination in production; **true** peer-to-peer only in direct mode. |

**Confidence:** **Medium** for production deployment choice; **High** for code paths.

---

## 6. Evidence Timeline

No real-world timestamps were provided. **Sequence-only** timeline from code and tests:

| Seq | Source artifact | Observed event | Interpretation | Confidence |
|-----|-----------------|----------------|----------------|------------|
| 1 | `ipc.ts` | `enqueueOutboundCapsule` after successful parse | Row inserted: `pending`, `retry_count=0` | **Confirmed** (code) |
| 2 | `outboundQueue.ts` | First `processOutboundQueue` with `retry_count===0` | **No** backoff branch; transport runs | **Confirmed** |
| 3 | `p2p-transport.test.ts` `P2_03` | HTTP 500 from mock | `retry_count` becomes 1, `last_attempt_at` set | **Confirmed** (test) |
| 4 | `outboundQueue.ts` | Second immediate `processOutboundQueue` | Backoff: return **“Delivery is waiting…”** without HTTP | **Confirmed** |
| 5 | User incident | *Unknown* | Would require logs/DB to place real timestamps | **Unknown** |

---

## 7. Hypothesis Tree

Scoring: **likelihood 1–10** for the **user-visible failure mode** (seeing the message / failed delivery), with evidence tags.

### 7.1 Peer discovery / rendezvous failure

- **Why it fits:** If `p2p_endpoint` is wrong or peer never registered, HTTP could fail repeatedly.
- **Why it may not fit:** The specific quoted string is **not** a discovery error; it is **backoff**.
- **Evidence supporting:** `ipc.ts` rejects missing `p2p_endpoint` **before** enqueue.
- **Evidence missing:** Live relay registration state.
- **Checks:** Verify `p2p_endpoint` on handshake row; test URL reachability (curl/TLS).
- **Likelihood:** **4/10** for underlying issue; **1/10** as explanation of **this exact string**.

### 7.2 Transport/session establishment failure

- **Why it fits:** `fetch` errors, HTTP 5xx, TLS issues increment `retry_count` → backoff message on next call.
- **Why it may not fit:** First failure stores a **different** `userError` in DB; backoff message **masks** it briefly in RPC return.
- **Evidence supporting:** `sendCapsuleViaHttpWithAuth` returns `{ success: false, error, statusCode }`.
- **Checks:** Inspect `outbound_capsule_queue.error` after first failure; packet capture on POST.
- **Likelihood:** **7/10** as **background** cause of retries; **3/10** as direct source of quoted string.

### 7.3 Retry scheduler / queueing issue

- **Why it fits:** **Exact match.** Backoff is implemented here; tests prove second call does not increment `retry_count` (`P2_04`).
- **Why it may not fit:** “Issue” is **by design**; misread as failure if UX does not show countdown.
- **Evidence supporting:** `outboundQueue.ts` + unit test.
- **Checks:** Read `last_attempt_at` and compute `backoffDelay(retry_count-1)`; wait and retry.
- **Likelihood:** **9/10** for the quoted message.

### 7.4 Rate limiting / throttling / anti-abuse

- **Why it fits:** Server might return 429 → retries → backoff on client.
- **Why it may not fit:** Client message does not distinguish 429 from other failures; backoff is **local**, not server rate headers.
- **Checks:** HTTP status in logs / `formatP2PErrorForUser` output; response body in `[P2P-DEBUG]`.
- **Likelihood:** **5/10** if coordination returns 429; **2/10** for the literal string alone.

### 7.5 Content/package problem

- **Why it fits:** Bad JSON could fail earlier at `JSON.parse` in `sendBeapViaP2P` (returns **before** enqueue).
- **Why it may not fit:** Invalid package unlikely to produce **only** the backoff string unless a **prior** attempt had already run.
- **Checks:** Validate `packageJson` in IPC; review builder output.
- **Likelihood:** **3/10**.

### 7.6 Environment / network path issue

- **Why it fits:** DNS, VPN, firewall → `fetch` throws → retry_count rises.
- **Why it may not fit:** Same as transport; backoff message is subsequent UI noise.
- **Checks:** `curl` to coordination URL; resolve DNS; test off VPN.
- **Likelihood:** **6/10** as background; **2/10** for the string in isolation.

### 7.7 Client/app state issue

- **Why it fits:** Missing OIDC → `recordCoordinationPreflightFailure` increments retry → backoff.
- **Checks:** Log `[P2P-QUEUE] Early return: No OIDC token`; confirm SSO session.
- **Likelihood:** **6/10** in coordination mode.

### 7.8 Misidentified target object (“beap” ambiguity)

- **Why it fits:** N/A if user meant “BEAP path” — resolved in §3.
- **Checks:** Confirm user referred to **BEAP P2P** vs unrelated “beep” / ticket typo.
- **Likelihood:** **2/10** for terminology confusion.

---

## 8. Most Likely Root Causes

Ranked for **observed error text**:

| Rank | Cause | Symptoms | Corroborating evidence | Verification | Likely fix |
|------|--------|----------|------------------------|--------------|------------|
| 1 | **Local exponential backoff** | Message **exactly** matches; `queued: true`; no new HTTP | Code reference §4 | Wait ≥ backoff; re-run `processOutboundQueue` | UX: show **countdown** or **last_error** from DB |
| 2 | **Prior HTTP/network/auth failure** | Same message **after** first failure; DB shows `retry_count ≥ 1` | `outbound_capsule_queue.error` non-empty | Read row; logs `[P2P] Coordination delivery failed` | Fix token, URL, peer reachability, server health |
| 3 | **Coordination preflight** (no token / no URL) | `error` column like “No OIDC token” / “Coordination URL not configured” | `recordCoordinationPreflightFailure` | Login; set `coordination_url` in P2P config | Config + SSO |

---

## 9. Diagnostic Plan

### 9.1 Immediate checks (5–15 minutes)

| Step | Action | Expected if healthy | Failure implies | Hypothesis |
|------|--------|---------------------|-----------------|------------|
| 1 | Locate main log for `[P2P-SEND]` / `[P2P-QUEUE]` for `handshake_id` | Prior attempt logged | No log → drain not running / wrong build | 7.3 |
| 2 | Query `outbound_capsule_queue` for handshake | `error` from **last** real attempt | Empty vs message mismatch | 7.2, 7.7 |
| 3 | Compute wait: `required = min(5000*2^(retry_count-1), 300000)` ms from `last_attempt_at` | After wait, next send attempts HTTP | Still backoff → clock skew rare | 7.3 |

**Windows (SQLite):** Use a SQLite browser on the app DB path (product-specific; locate via WR Desk docs or `%APPDATA%` profile). Example query pattern:

```sql
SELECT id, handshake_id, status, retry_count, last_attempt_at, error, substr(capsule_json,1,120)
FROM outbound_capsule_queue
WHERE status = 'pending'
ORDER BY created_at ASC;
```

### 9.2 Short investigation (30–60 minutes)

| Step | Action | Success | Failure | Hypothesis |
|------|--------|---------|---------|------------|
| 4 | `curl` / `Invoke-WebRequest` POST to `{coordination_url}/beap/capsule` with test body (careful: auth) | Controlled 401/400 proves reachability | Timeout/DNS | 7.6 |
| 5 | Verify `getP2PConfig`: `use_coordination`, `coordination_url` | URL present | Misconfig | 7.7 |
| 6 | Compare JWT `aud` to server expectation (logs print `Token aud`) | Match | 401 loop | 7.2, 7.7 |

### 9.3 Deep investigation (1–4 hours)

| Step | Action | Notes | Hypothesis |
|------|--------|-------|------------|
| 7 | Full TLS capture (mitm only in dev) | Validate cert chain | 7.2, 7.6 |
| 8 | Replay `processOutboundQueue` under debugger | Step through backoff vs transport | 7.3 |
| 9 | Load test coordination with same capsule size | Size/timeouts | 7.2 |

---

## 10. Remediation Plan

### Temporary workarounds

- **Wait** for the backoff window (up to **5 minutes** cap per step, depending on `retry_count`).
- **Avoid double-clicking send**; backoff message often follows **rapid** re-entrancy.

### Safe low-risk fixes

- **UI:** When RPC returns this error, also display **`outbound_capsule_queue.error`** and **seconds until retry** (computed from `last_attempt_at` + `backoffDelay(retry_count-1)`).
- **Logging:** Log `elapsed` / `required` when returning backoff (debug builds).

### Medium-risk structural fixes

- **Separate error codes**: e.g. `BACKOFF_WAIT` vs `TRANSPORT_ERROR` so the extension does not treat backoff as generic failure.
- **Trigger drain after backoff** with `setTimeout` aligned to remaining wait (reduces user-initiated spam).

### Long-term architectural improvements

- **Observability:** Structured JSON logs with `queue_row_id`, `handshake_id`, `phase: backoff|transport|success`.
- **Metrics:** Histogram of `retry_count`, coordination HTTP status, latency.

### By layer

| Layer | Action |
|-------|--------|
| Client | Clearer copy; countdown; surface DB `error` |
| Network | Ensure coordination URL reachable; fix VPN/DNS |
| Platform | OIDC audience alignment; coordination SLA / 5xx handling |
| Operational | Runbook: “If backoff repeats, read `outbound_capsule_queue.error`” |

---

## 11. Reproduction Matrix

| Test | Setup | If backoff message appears | If delivery succeeds | Implication |
|------|-------|----------------------------|----------------------|-------------|
| Same peer, send twice quickly | Two `sendBeapViaP2P` in &lt;5s after failure | **Likely** | Second may backoff | Confirms **7.3** |
| Same network, wait 5+ min after failure | Low `retry_count` | Unlikely | Likely retry HTTP | Separates backoff vs transport |
| IPv4 vs IPv6 | Toggle | Intermittent fetch errors | Stable | **7.6** |
| VPN on/off | Compare | Timeouts on VPN | Works off VPN | Path issue |
| Coordination vs direct | `use_coordination` flag | Different errors in DB | — | **Variant A vs B** |
| Small vs large capsule | Payload size | Timeout at transport | OK small | **7.2** |

---

## 12. Observability Gaps

| Gap | Impact | Recommendation |
|-----|--------|----------------|
| Backoff return **does not log** elapsed/required | Hard to correlate user reports | Log at INFO when backoff triggers |
| RPC error **replaces** visibility of **stored** `outbound_capsule_queue.error` | User sees generic “try shortly” | Return `last_transport_error` field |
| No **correlation ID** across extension ↔ main | Multi-tab confusion | Propagate `client_send_id` |
| No **queue depth** in user UI | Unknown backlog | Expose `getQueueStatus` |
| Coordination **response body** only in console warn path | Lost in field logs | Persist last HTTP body snippet (redacted) |

---

## 13. Final Assessment

- **Most probable explanation** for the **exact** string **“Delivery is waiting before retry — try again shortly”**: the Electron **`processOutboundQueue`** backoff branch (**§4**) fired because **`retry_count > 0`** and **elapsed &lt; required delay** since **`last_attempt_at`**. **Confidence: High.**

- **Alternative explanations** for **overall** “P2P BEAP delivery didn’t work”: prior **HTTP failure**, **missing OIDC**, **bad coordination URL**, or **peer unreachable** — evidenced by **`outbound_capsule_queue.error`** and transport logs, **not** by the backoff string alone. **Confidence: Medium** (typical) pending logs.

- **Residual uncertainty:** Without runtime logs/DB rows, we cannot name the **first** failure that triggered retries.

- **Recommended next action:** Inspect **`outbound_capsule_queue`** for **`error`**, **`retry_count`**, **`last_attempt_at`**, and main-process logs **`[P2P-QUEUE]` / `[P2P-SEND]`** for the same **`handshake_id`**, then wait one backoff cycle and retry or let the periodic drain run.

---

## 14. Appendices

### Appendix A — Quoted log / code excerpts

**Backoff return (authoritative):**

```116:127:apps/electron-vite-project/electron/main/handshake/outboundQueue.ts
    // Exponential backoff: skip if not enough time since last attempt
    const lastAttempt = db.prepare('SELECT last_attempt_at FROM outbound_capsule_queue WHERE id = ?').get(row.id) as { last_attempt_at: string | null } | undefined
    if (lastAttempt?.last_attempt_at && row.retry_count > 0) {
      const elapsed = Date.now() - Date.parse(lastAttempt.last_attempt_at)
      const required = backoffDelay(row.retry_count - 1)
      if (elapsed < required) {
        return {
          delivered: false,
          error: 'Delivery is waiting before retry — try again shortly',
          queued: true,
        }
      }
    }
```

**Coordination endpoint:**

```40:47:apps/electron-vite-project/electron/main/handshake/p2pTransport.ts
export async function sendCapsuleViaCoordination(
  capsule: object,
  coordinationUrl: string,
  oidcToken: string,
): Promise<SendCapsuleResult> {
  const base = coordinationUrl.replace(/\/$/, '')
  const targetEndpoint = `${base}/beap/capsule`
  return sendCapsuleViaHttpWithAuth(capsule, targetEndpoint, oidcToken)
}
```

### Appendix B — Parsed error strings

| String | Origin | Type |
|--------|--------|------|
| `Delivery is waiting before retry — try again shortly` | `outboundQueue.ts` | **Client backoff** |
| `No OIDC token — please log in` | `recordCoordinationPreflightFailure` | **Auth / config** |
| `Coordination URL not configured` | Same | **Config** |
| `Authentication failed — please log in again` | `processOutboundQueue` if HTTP 401 | **Auth** |

### Appendix C — Normalized event table (code-level)

| Event | Field / condition | Next state |
|-------|-------------------|------------|
| `enqueueOutboundCapsule` | `retry_count=0`, `status=pending` | Row created |
| Transport failure (non-401) | `retry_count++`, `last_attempt_at=now` | `pending` or `failed` if max |
| Backoff | No DB update on early return | `pending` unchanged |
| Success | `status=sent` | Done |

### Appendix D — Open questions

1. What was **`outbound_capsule_queue.error`** at the time the user saw the message?
2. Was **`use_coordination`** true in that environment?
3. Did **`processOutboundQueue`** run from **`sendBeapViaP2P`** immediately after a **failed** attempt (same second)?

### Appendix E — Assumptions register

| ID | Assumption | Status |
|----|------------|--------|
| A1 | User runs WR Desk / Electron build containing `outboundQueue.ts` as shipped | **Probable** |
| A2 | The quoted English string matches this codebase (not a fork) | **Probable** |
| A3 | “P2P BEAP delivery” maps to `handshake.sendBeapViaP2P` | **Probable** |

---

*Report generated from repository source analysis. No production incident artifacts were embedded.*

# Prompt 5 session record — 2026-06-10

**Agent session:** Windows dev box (win32 10.0.26200). NOT the mini-PC rig.

**Branch:** `feature/layered-sandbox`  
**HEAD at session open:** `f9106441` (Prompt-4 follow-ups; two-box pairing from
2026-06-08 was the last rig session).

---

## Summary

| Part | Description | Result |
|---|---|---|
| **Pre-flight** | `git pull`, branch confirm, HEAD | **PASS** — `f9106441`, `feature/layered-sandbox` |
| **Part A** | Build C final leg — depackage-email critical job through crosvm microVM | **NOT RUN** — requires mini-PC rig |
| **Part B** | A2 live ingestion — sandbox read-client fetches real message | **NOT RUN** — requires rig + live OAuth tokens |
| **Part C code** | RFC822 fidelity test suite (`outlookRfc822Fidelity.test.ts`) | **DONE — 12 pass, 4 rig-skip** |
| **Part C live** | Outlook `/$value` fidelity vs real Microsoft Graph endpoint | **NOT RUN** — requires rig + Microsoft test account |

**Verdict:** No hardware or live-account proof was possible this session. The
`/$value` code path is fully implemented and code-tested; the four live-account gates
(`RIG-1` through `RIG-4` in `outlookRfc822Fidelity.test.ts`) remain as explicit
`it.skip` blocks. `WRDESK_OUTLOOK_OPAQUE_INPUT` remains off-by-default.
`OutlookOpaqueUnprovenError` stays in place.

---

## Part C code-testable results

**File:** `email/__tests__/outlookRfc822Fidelity.test.ts`  
**Run:** `npx vitest run …/outlookRfc822Fidelity.test.ts` — 12 passed, 4 skipped, 0 failed.

| Test | Number | Result |
|---|---|---|
| Simple RFC822: rawRfc822 byte-identical to mock response | 1 | PASS |
| Multipart/mixed with binary attachment: every byte intact | 8 | PASS |
| RFC 2047 Q-encoded header: bytes stored verbatim | 7 | PASS |
| Body fields empty (host never reads body from `/$value` bytes) | 2a | PASS |
| headers map empty (no header inspection on host) | 2b | PASS |
| Operational metadata: isRead/isDraft/hasAttachments/receivedDateTime | 3a | PASS |
| isDraft=true lands in flags.draft | 3b | PASS |
| Metadata fetch failure is non-fatal: defaults used, rawRfc822 still set | 4 | PASS |
| Empty `/$value` body throws (fail closed) | 5a | PASS |
| Null `/$value` response throws (fail closed) | 5b | PASS |
| Flag OFF (default): rejects with OutlookOpaqueUnprovenError | flag-off | PASS |
| `/$value` happy-path reachable; retry-on-429 deferred to rig | 6 | PASS |
| **RIG-1:** Mail.Read scope sufficient for `/$value` (no 403) | — | **SKIP (rig)** |
| **RIG-2:** `/$value` bytes byte-identical to original MIME | — | **SKIP (rig)** |
| **RIG-3:** Binary attachment survives `/$value` roundtrip | — | **SKIP (rig)** |
| **RIG-4:** Real 429 pacing — Retry-After respected | — | **SKIP (rig)** |

---

## Rig readiness status (as of last rig session 2026-06-08)

From `depackaging-microvm/rig/README.md` provisioning note and 2026-06-08 evidence:

| Check | Status |
|---|---|
| crosvm installed (`~/.local/bin/crosvm`, HEAD `938fc36`) | OK (2026-06-05 reprovision) |
| Golden image (`sha256 68374091…`, kernel `6.17.0-35-generic`) | OK |
| `/dev/kvm` ACL for user `konge` | OK (2026-06-05) |
| `/dev/vhost-vsock` ACL | **OPEN** — `sudo usermod -aG kvm konge` + udev rule must be re-verified post-reboot |
| `E_IMAGE_BUNDLE_MISMATCH` preflight | NOT CHECKED — must pass on rebuilt bundle at HEAD `f9106441`+ |

---

## INV-5 check

No OAuth tokens, email content, or `p2p_auth_token` values in this directory.
This session produced only code (`outlookRfc822Fidelity.test.ts`) and documentation.

# P2P Transport Tests — better-sqlite3 Fix Report

## Fix Applied

- **Method used:** rebuild
- **Node version alignment:** `better-sqlite3` was originally compiled for Node 24 (NODE_MODULE_VERSION 123) while Vitest runs on Node 20 (115). Ran `npm rebuild better-sqlite3` in `apps/electron-vite-project` to recompile the native module for the current Node version.
- **Additional fixes:**
  - Added `resetRateLimitsForTests()` in `rateLimiter.ts` and call it in `beforeEach` for P3 and P4 suites to avoid 429 rate-limit failures from auth failures bleeding across tests.
  - Added `createValidHandshakeWithContextSync()` helper that runs a full initiate → accept flow via `handleIngestionRPC` / `submitCapsuleToPipeline`, builds a valid context_sync capsule with `last_capsule_hash_received: acceptCapsule.capsule_hash`, and updates the handshake with `counterparty_p2p_token` for auth. P3 and P4 `beforeAll` now use this instead of manually inserting handshake records.
  - Restored `insertHandshakeRecord` import from `handshake/db` for P2_08 (auth token loaded).
  - Added a real `Database` probe in the top-level `try` block so `sqliteAvailable` is only false when the native module is actually unusable.

## Re-run Results

| Test ID | Previous | Now | Notes |
|---------|----------|-----|-------|
| P1_01 | PASS | PASS | HTTP transport, no DB |
| P1_02 | PASS | PASS | Bearer token |
| P1_03 | PASS | PASS | Without token |
| P1_04 | PASS | PASS | Timeout handling |
| P1_05 | PASS | PASS | Endpoint unreachable |
| P1_06 | PASS | PASS | Endpoint 500 |
| P1_07 | PASS | PASS | Invalid URL |
| P2_01 | SKIP | PASS | Enqueue with real DB |
| P2_02 | SKIP | PASS | Process success |
| P2_03 | SKIP | PASS | Failure retry |
| P2_04 | SKIP | PASS | Exponential backoff |
| P2_05 | SKIP | PASS | Max retries exceeded |
| P2_06 | SKIP | PASS | Queue ordering |
| P2_07 | SKIP | PASS | Get status |
| P2_08 | SKIP | PASS | Auth token loaded |
| P3_01 | SKIP | PASS | Valid context-sync accepted |
| P3_02 | SKIP | PASS | Wrong content-type → 415 |
| P3_03 | SKIP | PASS | No content-type → 415 |
| P3_04 | SKIP | PASS | Body too large → 413 |
| P3_05 | SKIP | PASS | Invalid JSON → 400 |
| P3_06 | SKIP | PASS | Missing handshake_id → 400 |
| P3_07 | SKIP | PASS | Wrong HTTP method → 404 |
| P3_08 | SKIP | PASS | Unknown route → 404 |
| P3_09 | SKIP | PASS | Empty body → 400 |
| P4_01 | SKIP | PASS | Valid auth accepted |
| P4_02 | SKIP | PASS | Missing auth header → 401 |
| P4_03 | SKIP | PASS | Wrong token → 401 |
| P4_04 | SKIP | PASS | Unknown handshake_id → 401 |
| P4_06 | SKIP | PASS | Malformed auth header → 401 |
| P4_07 | SKIP | PASS | Empty token → 401 |

## Newly Discovered Failures

- None. All tests pass with the real DB.

## Summary

- **Previously skipped:** 15 (P2_01–P2_08, P3_01–P3_09, P4_01–P4_07)
- **Now actually passing:** 30
- **Now failing:** 0

---

*Report generated after full test run on 2026-03-05.*

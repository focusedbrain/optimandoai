# PR: CPU Fix 3 — Remove Duplicate `drainExtensionMergeBuffer` from 60s Timer

## Diagnostic finding

The interval-pattern diagnostic identified that
`drainExtensionMergeBuffer` was called from **two** periodic timers
in `apps/electron-vite-project/electron/main.ts`:

| Site | Timer | Location |
|------|-------|----------|
| **Canonical** | `setInterval(tryP2PStartup, 10_000)` | ~L11351 (inside `processPendingP2PBeapEmails` `.then()`) |
| **Redundant** | `setInterval(..., 60_000)` P2P health tick | ~L11524 (removed by this PR) |

The 10s tick runs **6 times** inside every 60s window, making the 60s
drain entirely redundant. Together the two cadences produced 7 drain
calls per minute. This PR reduces it to 6.

## Decisions

### Decision A — 10s drain cadence is canonical

`tryP2PStartup` runs every 10s; the drain inside its BEAP email chain
is the correct site. The 60s timer's purpose is **P2P health queue
count recomputation** — buffer draining was bundled in incorrectly.

### Decision B — Preserve all other 60s timer work

The 60s timer still runs. Only the `drainExtensionMergeBuffer` call is
removed. The outbound queue count query (`SELECT status, COUNT(*) …`)
and `setP2PHealthQueueCounts` update are intact.

### Decision C — No behavior change for the retry buffer

- Buffer semantics unchanged (B-5.1).
- Event-driven drains (`P2P_BEAP_RECEIVED` handler, vault unlock
  `setImmediate`) are unchanged.
- Net frequency: **6 drains/min** instead of **7 drains/min**.
  Operationally indistinguishable — sandbox availability is detected
  within 10s (the next tick).

## Files changed

| File | Change |
|------|--------|
| `apps/electron-vite-project/electron/main.ts` | Removed `drainExtensionMergeBuffer` call from 60s timer; updated comment on 60s timer; added canonical-drain comment at 10s site |

## Stop-and-report conditions encountered

None. The `drainExtensionMergeBuffer` call in the 60s timer was
`void`-discarded, structurally independent from
`setP2PHealthQueueCounts`. Clean removal.

## `drainExtensionMergeBuffer` call sites after this PR

```
grep drainExtensionMergeBuffer main.ts
  L919   import statement
  L11242 event-driven: P2P_BEAP_RECEIVED handler (not periodic — fine)
  L11351 canonical 10s periodic drain inside tryP2PStartup
```

The 60s timer no longer appears in that list.

## Verification log

```
vitest run (with fix)
  Test Files  146 failed | 104 passed (250)
  Tests  30 failed | 830 passed (baseline identical)

vitest run (without fix / stash baseline)
  Test Files  146 failed | 104 passed (250)
  Tests  30 failed | 830 passed

Zero new failures introduced.
```

Pre-existing failures are all unrelated to this change (internal
inference routing, `resolveSandboxInferenceTarget`, etc.).

## What was NOT verified

- Whether removing the 60s drain call produces a measurable CPU
  reduction on the canon owner's machine. This is the smallest of the
  three identified fixes; the ENTITLEMENT_REFRESH (Fix 2) and
  `tryP2PStartup` gating (Fix 1) are the larger contributors.
- Whether the retry buffer ever fills to the point where the 7th
  drain per minute was meaningfully helping (static analysis only;
  operational verification requires re-enabling the extension).

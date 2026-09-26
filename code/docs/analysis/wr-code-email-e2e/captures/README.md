# Committed failure-identity sets

**Standing rule — CAPTURE PERSISTENCE (author, 2026-08-11).** Each phase's
before/after failure-identity sets are committed here alongside the phase
report. The artifact that makes identity comparison possible must survive any
VM.

The rule exists because it was learned the hard way: the VM was reprovisioned
between the Phase-4 report and the seal-key-source fix, taking every `/tmp`
capture with it. A fresh baseline at the *unchanged* commit `0a7ca3ae` then read
168 failures where the Aug-9 capture had read 166 — and the difference could not
be attributed identity-by-identity, because the earlier identity set no longer
existed anywhere.

## What is stored

Identity lists, not the full vitest JSON. The JSON is ~2 MB per capture and its
only load-bearing content for do-not-regress is the set of
`file :: ancestors title` strings, plus the counts needed to check the validity
guard. Both are in the header of each file.

## Naming

```
<change>.<before|after>.<short-sha>.txt
```

## Reading a pair

The comparison is set difference, both directions:

- present in `after` and not in `before` ⇒ **new failure** (a regression)
- present in `before` and not in `after` ⇒ **repaired** (never assumed to be
  caused by the change; attribute it or say you did not)

Counts alone are not the criterion. Two suites in this repo change their
full-workspace failure count with scheduling — see the named finding
`test-isolation bidirectional risk` — so a count that matches can still hide a
swap, and a count that differs can be pure environment drift.

## Environment caveat

A pair is only meaningful **within one environment**. Never diff a baseline
taken on one VM against an after-capture taken on another; re-take the baseline
instead.

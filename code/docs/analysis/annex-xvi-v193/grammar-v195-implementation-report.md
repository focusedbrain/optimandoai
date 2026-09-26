# WR Code Grammar v1.95 — Implementation Run Report

Branch `integration/consolidated-current`, commits `003a52bf..d16ce144`.
Authority: `docs/spec/Annex_XVI_WR_Code_v1.95.pdf` (SHA256 `064AAD6D…829F`),
pinned intact at start and end. Suite: 6177 tests / 154 pre-existing failures
before → 6247 / 153 after. **Zero new failures**; the one delta is an
unrelated flaky hardware test that happened to pass.

## What shipped

1. **Core grammar** (`003a52bf`) — `wrCodeGrammar.ts`: table-driven class
   registry (P/I/C/SP/SI/SC/SE declare fields, class values, check placement
   per §XVI.5.11), prefix grammar with S non-terminal, prefix-before-alias
   normalization, class-aware check on the untouched Damm core, capture /
   build / display / free-text detection / stored-value classifier. 95 tests:
   all A.2 rows and published negatives, exhaustive mutations, alias order.
2. **API replacement** (`e4d3cf0e`) — `captureBaselineCode`,
   `formatBaselineCodeForDisplay`, `BASELINE_CODE_*` deleted; v1.4 conformance
   suite retired (its arithmetic pins live in the Appendix A suite + byte
   guard). `renderCodeForDisplay` now renders v2 only; old canonicals → null.
3. **Detection & capture** (`d5e4db5e`) — plain-email body scan behind the
   same `channel_pass` gate as BEAP detection; verified detections persisted
   seal-bound beside the CPR. New `wrc.captureReference` loopback RPC as the
   manual-entry path (local, typed reasons, no network). Grammar registry
   material v2.0 doc + entry-for-entry transcription guard.
4. **Offers** (`17aa6db3`) — `wr_code_class` column (idempotent migration);
   staging re-captures the canonical and refuses class/publisher/entry-block
   mismatches (`invalid_wr_code`). Schema suite moved to the A.2 P reference.
   No old-format fixtures or UI copy found elsewhere; pairing codes untouched.
5. **Persistence** (`d16ce144`) — sweep found textual canonicals only in
   `wr_connect_offers` (other stores hold publisher parts/epochs, unchanged
   under v1.95). Legacy rows keep their history but consent returns
   `WR_CODE_LEGACY_FORMAT`. Nothing rewritten or deleted; no blocker exit.

## Decisions under pre-authorization

- No dual acceptance anywhere: old codes reject as `unknown_prefix` (or
  `wrong_length` when the first symbol collides with a class symbol).
- Free-text **detection** accepts hyphen-grouped and ungrouped forms only; a
  space inside a candidate is treated as a boundary because it is
  indistinguishable from the gap between two adjacent references. Space
  grouping remains accepted at the manual-entry gate per §XVI.5.5.
- Crockford aliases also apply to the check-symbol position (the alphabet has
  no I/L/O, so the alias is the only reading; the check still must verify).
- Preview hash unchanged: the class is the canonical's prefix, already covered
  by `wr_code_canonical`; adding a hashed field would break pre-v2 consent pins.
- `entry_local_part` reused as the third-block column for all classes (local /
  combination / counterparty) instead of a destructive rename.
- **Spec observation, not a blocker**: SP's class values [25, 22] fold to
  interim 1 = I's class value, so an SP↔I prefix substitution preserves the
  check. §XVI.5.4 never claims that pair (it names SP-for-P, C-for-I, C
  transposition — all detected). The collision set is pinned in tests; the
  swap is caught at resolution since block-3 semantics differ.

## TODO attachment points left

- §XVI.7.7 capture indicator + SUBMITTED state, §XVI.7.6 six gates, §XVI.8.4
  one-time-use — marked in `wrCodeEmailDetection.ts`; detections are display
  material until an explicit submission act.
- §XVI.5.8 progressive verification (P/SP/C previews) — attaches between
  `wrc.captureReference` and `wrc.resolvePublisher`.

## Open items

- No renderer/extension UI consumed the old grammar and none was built here;
  the manual-entry RPC and persisted detections are the ready seams.
- Resolution semantics for I/C/S\* classes (combination-code expansion,
  recipient binding) are untouched — capture is class-complete, the resolver
  still speaks publisher parts + entry ids only.
- v1.96 (cosmetic errata: §XVI.5.5 SE row, A.2 bracket, footer) — re-pin the
  hash in the registry material and the two conformance suites when ratified.

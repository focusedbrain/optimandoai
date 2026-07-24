# Backlog: `@shared` consolidation for `localModelIdentity`

**Status:** deferred (reverted sandbox commit `404fc494` on Host `.28`, 2026-07-11)

## Scope (future PR)

- Move `localModelIdentity` helpers (`canonicalLocalModelName`, `resolveLocalModelAlias`, `localModelIdsMatch`, `dedupeCanonicalModelNames`) into `packages/shared` as the single source of truth for Electron main **and** extension WR chat surfaces.
- Add proactive roster reconciliation on model refresh (`reconcileWrChatExtensionModelWithRoster` pattern from reverted commit) as a separate, reviewed change — not bundled silently with the shared-package move.
- Add parity / unit tests under `packages/shared` (or a shared test target) so extension and electron cannot diverge without CI failure.
- Electron re-export should use the `@shared` Vite alias, not a fragile relative path (`../../../../../packages/shared/...`).

## Reference

- Reverted commit: `404fc494` (`fix(wrchat): build043 canonical model identity for extension surfaces`)
- Revert on Host: `479b7de7` (content restored to Host-authored `95bcaa03` mirror approach)
- Current shipping approach: mirrored `apps/extension-chromium/src/lib/localModelIdentity.ts` + `wrChatSelectionHygiene.ts` (build044)

## Do not reuse build stamp

`build043` was consumed by two competing commits (`95bcaa03` Host, `404fc494` Sandbox). Use `build044+` for Host-verified artifacts after the revert.

/**
 * Which WRC trust configuration this runtime may use.
 *
 * Bundled builds carry a compile-time flavor (`__WRC_BUILD_FLAVOR__`, set in
 * `vite.config.ts`); only an unbundled run (vitest) has none.
 *
 *   - `release`  — trust anchors come from `wrcTrustAnchors.ts` only; the
 *                  environment cannot replace them (§XVI.6.4 "pinned").
 *   - `wrc-test` — the in-process test registry (`wrcTestRegistry.ts`); the
 *                  environment cannot replace it either. Built only by
 *                  `pnpm run build:wrc-test`.
 *   - `dev`      — unbundled runs only: environment configuration, for tests.
 *
 * A bundle whose define carries any value other than `wrc-test` is `release`,
 * so a mistyped flavor fails closed instead of reopening the environment path.
 */

declare const __WRC_BUILD_FLAVOR__: string | undefined

export type WrcBuildFlavor = 'release' | 'wrc-test' | 'dev'

let _override: WrcBuildFlavor | null = null

export function wrcBuildFlavor(): WrcBuildFlavor {
  if (_override) return _override
  if (typeof __WRC_BUILD_FLAVOR__ === 'undefined') return 'dev'
  return __WRC_BUILD_FLAVOR__ === 'wrc-test' ? 'wrc-test' : 'release'
}

/** Test seam: force a flavor (null restores the compile-time one). */
export function setWrcBuildFlavorForTests(flavor: WrcBuildFlavor | null): void {
  _override = flavor
}

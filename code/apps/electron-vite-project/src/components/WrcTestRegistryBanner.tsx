/**
 * Shown on every screen of a `wrc-test` build. Not dismissible, so built-in
 * test data can never be mistaken for real WR Code material.
 */
export function WrcTestRegistryBanner() {
  const flavor = typeof __WRC_BUILD_FLAVOR__ !== 'undefined' ? __WRC_BUILD_FLAVOR__ : 'release'
  if (flavor !== 'wrc-test') return null
  return (
    <div
      role="status"
      style={{
        flexShrink: 0,
        padding: '8px 14px',
        fontSize: '13px',
        fontWeight: 600,
        lineHeight: 1.45,
        background: 'color-mix(in srgb, var(--warning, #f59e0b) 16%, var(--bg-elevated, #ffffff) 84%)',
        color: 'var(--text-primary, #0f1419)',
        borderBottom: '1px solid color-mix(in srgb, var(--warning, #f59e0b) 45%, var(--border, #e1e8ed) 55%)',
      }}
    >
      WR Code test build: every WR Code resolves against built-in test publishers, not real ones.
    </div>
  )
}

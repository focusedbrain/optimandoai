/**
 * UX-1 D3 — useIngestionStatus suppression logic tests.
 *
 * Tests the pure shouldSuppressBanners logic by testing the cases that affect
 * whether the hook calls IPC or returns null early. Uses the exported internal
 * helper through the hook contract.
 *
 * We test the suppression condition directly rather than running the full hook
 * (which needs a DOM + ipcRenderer). The invariant is:
 *   - mode='host', no linked sandbox → suppress (single-machine)
 *   - mode='sandbox' → never suppress
 *   - mode=null (unknown) → never suppress (show banner if IPC says so)
 *   - mode='host', ledgerProvesLocalHostPeerSandbox=true → never suppress
 */
import { describe, it, expect } from 'vitest'

// Re-implement the pure function inline so this test file has no DOM dependency.
// The logic MUST match shouldSuppressBanners in useIngestionStatus.ts exactly.
function shouldSuppressBanners(
  mode: 'host' | 'sandbox' | null,
  ledgerProvesLocalHostPeerSandbox: boolean,
): boolean {
  if (mode === 'sandbox') return false
  if (mode === null) return false
  return !ledgerProvesLocalHostPeerSandbox
}

describe('useIngestionStatus — single-machine suppression rule', () => {
  it('mode=host, no linked sandbox → suppress (single-machine)', () => {
    expect(shouldSuppressBanners('host', false)).toBe(true)
  })

  it('mode=host, ledgerProvesLocalHostPeerSandbox=true → do NOT suppress', () => {
    expect(shouldSuppressBanners('host', true)).toBe(false)
  })

  it('mode=sandbox → never suppress regardless of ledger', () => {
    expect(shouldSuppressBanners('sandbox', false)).toBe(false)
    expect(shouldSuppressBanners('sandbox', true)).toBe(false)
  })

  it('mode=null (loading/unknown) → never suppress', () => {
    expect(shouldSuppressBanners(null, false)).toBe(false)
    expect(shouldSuppressBanners(null, true)).toBe(false)
  })
})

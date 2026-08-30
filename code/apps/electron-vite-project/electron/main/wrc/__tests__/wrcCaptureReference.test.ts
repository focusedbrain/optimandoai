/**
 * `wrc.captureReference` — the manual-entry RPC [XVI.5.8, XVI.5.9].
 *
 * The handler is a pure local wrapper over the grammar-v2 capture gate: no
 * transport, no store, no clock. What these tests pin is the CONTRACT the
 * extension sees — the typed result passes through verbatim, for every class,
 * with the fail-closed reason codes intact.
 */
import { describe, expect, it } from 'vitest'
import { handleWrcCaptureReference } from '../wrcRuntime'

describe('handleWrcCaptureReference', () => {
  it('captures a v1.95 reference of each shape with full framing', () => {
    const p = handleWrcCaptureReference({ raw: 'p wr7x4k 9b2m3c' })
    expect(p.success).toBe(true)
    if (p.success && p.result.ok) {
      expect(p.result.cls).toBe('P')
      expect(p.result.canonical).toBe('PWR7X4K9B2M3C')
      expect(p.result.publisher).toBe('WR7X4K')
      expect(p.result.local).toBe('9B2M3')
    }

    const se = handleWrcCaptureReference({ raw: 'SE-WR7X4K-6TCJ9F-P' })
    expect(se.success).toBe(true)
    if (se.success && se.result.ok) {
      expect(se.result.cls).toBe('SE')
      expect(se.result.combination).toBe('6TCJ9F')
    }
  })

  it('typed capture errors pass through for character-level correction', () => {
    const bad = handleWrcCaptureReference({ raw: 'P-WR7X4K-9B2M3D' })
    expect(bad.success).toBe(true)
    if (bad.success) {
      expect(bad.result.ok).toBe(false)
      if (!bad.result.ok) expect(bad.result.reason).toBe('check_failed')
    }

    const old = handleWrcCaptureReference({ raw: 'WR7X4K9B2M3P' })
    expect(old.success).toBe(true)
    if (old.success && !old.result.ok) expect(old.result.reason).toBe('unknown_prefix')
  })

  it('rejects a missing or non-string payload at the boundary', () => {
    expect(handleWrcCaptureReference({})).toEqual({ success: false, error: 'raw is required' })
    expect(handleWrcCaptureReference({ raw: 42 })).toEqual({ success: false, error: 'raw is required' })
  })
})

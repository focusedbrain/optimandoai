import { describe, it, expect } from 'vitest'
import {
  narrowBeapImportPayloadForBridge,
  narrowBeapFallbackModel,
  assertBeapTabImportPayload,
} from '../beapSessionBridgeGuards'

describe('beapSessionBridgeGuards', () => {
  it('narrowBeapImportPayloadForBridge rejects null, arrays, primitives', () => {
    expect(narrowBeapImportPayloadForBridge(null).ok).toBe(false)
    expect(narrowBeapImportPayloadForBridge(undefined).ok).toBe(false)
    expect(narrowBeapImportPayloadForBridge([]).ok).toBe(false)
    expect(narrowBeapImportPayloadForBridge('{}').ok).toBe(false)
  })

  it('narrowBeapImportPayloadForBridge accepts plain objects', () => {
    const g = narrowBeapImportPayloadForBridge({ a: 1 })
    expect(g.ok).toBe(true)
    if (g.ok) expect(g.payload.a).toBe(1)
  })

  it('narrowBeapFallbackModel trims or falls back', () => {
    expect(narrowBeapFallbackModel('  x ', 'd')).toBe('x')
    expect(narrowBeapFallbackModel('', 'd')).toBe('d')
    expect(narrowBeapFallbackModel(3, 'd')).toBe('d')
  })

  it('assertBeapTabImportPayload throws on invalid payload', () => {
    expect(() => assertBeapTabImportPayload(null)).toThrow()
  })
})

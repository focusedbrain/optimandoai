import { describe, test, expect } from 'vitest'

import {
  HANDSHAKE_TYPES,
  assertHandshakeTypeExhaustive,
  handshakeTypeUserLabel,
  isEdgeIngestorHandshake,
  isSameUserHandshake,
  isSandboxInternalHandshake,
  parseHandshakeType,
} from './handshakeType.js'

describe('handshakeType', () => {
  test('union includes edge_ingestor', () => {
    expect(HANDSHAKE_TYPES).toContain('edge_ingestor')
  })

  test('isSameUserHandshake covers internal and edge_ingestor', () => {
    expect(isSameUserHandshake('internal')).toBe(true)
    expect(isSameUserHandshake('edge_ingestor')).toBe(true)
    expect(isSameUserHandshake('standard')).toBe(false)
  })

  test('sandbox vs edge ingestor distinction', () => {
    expect(isSandboxInternalHandshake('internal')).toBe(true)
    expect(isSandboxInternalHandshake('edge_ingestor')).toBe(false)
    expect(isEdgeIngestorHandshake('edge_ingestor')).toBe(true)
    expect(isEdgeIngestorHandshake('internal')).toBe(false)
  })

  test('user labels', () => {
    expect(handshakeTypeUserLabel('edge_ingestor')).toBe('Verification server')
    expect(handshakeTypeUserLabel('internal')).toBe('Sandbox device')
  })

  test('exhaustiveness over all handshake types', () => {
    for (const t of HANDSHAKE_TYPES) {
      expect(() => assertHandshakeTypeExhaustive(t)).not.toThrow()
    }
    expect(parseHandshakeType('edge_ingestor')).toBe('edge_ingestor')
    expect(parseHandshakeType('bogus')).toBeNull()
  })
})

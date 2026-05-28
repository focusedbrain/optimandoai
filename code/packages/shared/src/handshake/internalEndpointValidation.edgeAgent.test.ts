import { describe, test, expect } from 'vitest'

import {
  isAllowedEdgeIngestorRolePair,
  isAllowedInternalRolePair,
  isAllowedRolePairForHandshakeType,
  isAllowedSandboxInternalRolePair,
} from './internalEndpointValidation.js'

describe('edge_agent role pairing (Stream C / PR4.5)', () => {
  test('host + edge_agent allowed for edge_ingestor type', () => {
    expect(isAllowedEdgeIngestorRolePair('host', 'edge_agent')).toBe(true)
    expect(isAllowedEdgeIngestorRolePair('edge_agent', 'host')).toBe(true)
    expect(isAllowedRolePairForHandshakeType('edge_ingestor', 'host', 'edge_agent')).toBe(true)
  })

  test('sandbox + edge_agent rejected for all types', () => {
    expect(isAllowedEdgeIngestorRolePair('sandbox', 'edge_agent')).toBe(false)
    expect(isAllowedRolePairForHandshakeType('edge_ingestor', 'sandbox', 'edge_agent')).toBe(false)
    expect(isAllowedRolePairForHandshakeType('internal', 'sandbox', 'edge_agent')).toBe(false)
  })

  test('edge_agent not allowed on internal (sandbox) type', () => {
    expect(isAllowedInternalRolePair('host', 'edge_agent')).toBe(false)
    expect(isAllowedSandboxInternalRolePair('host', 'edge_agent')).toBe(false)
    expect(isAllowedRolePairForHandshakeType('internal', 'host', 'edge_agent')).toBe(false)
  })

  test('host + sandbox allowed only for internal type', () => {
    expect(isAllowedRolePairForHandshakeType('internal', 'host', 'sandbox')).toBe(true)
    expect(isAllowedRolePairForHandshakeType('edge_ingestor', 'host', 'sandbox')).toBe(false)
  })
})

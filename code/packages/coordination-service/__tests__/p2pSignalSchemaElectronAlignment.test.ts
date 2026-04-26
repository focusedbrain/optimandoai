import { describe, it, expect } from 'vitest'
import { P2P_SIGNAL_SCHEMA_VERSION } from '../src/p2pSignal.ts'
import { P2P_SIGNAL_WIRE_SCHEMA_VERSION } from '../../../apps/electron-vite-project/electron/main/internalInference/p2pSignalWireSchemaVersion.ts'

describe('P2P signal wire schema version (relay vs Electron)', () => {
  it('matches Electron outbound constant — drift surfaces as 400 P2P_SIGNAL_SCHEMA_REJECTED', () => {
    expect(P2P_SIGNAL_SCHEMA_VERSION).toBe(P2P_SIGNAL_WIRE_SCHEMA_VERSION)
  })
})

/**
 * Relay allowlist alignment — sealed_service_rpc_v1 (Prompt A2).
 */

import { describe, test, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { COORDINATION_RELAY_ALLOWED_CAPSULE_TYPES } from '../../handshake/p2pTransport'
import { SEALED_SERVICE_RPC_CAPSULE_TYPE } from '@repo/ingestion-core'

const electronMain = join(__dirname, '..', '..')
const coordinationServer = join(electronMain, '..', '..', '..', '..', 'packages', 'coordination-service', 'src', 'server.ts')

describe('sealed_service_rpc_v1 relay allowlist alignment', () => {
  test('app COORDINATION_RELAY_ALLOWED_CAPSULE_TYPES includes sealed_service_rpc_v1', () => {
    expect(COORDINATION_RELAY_ALLOWED_CAPSULE_TYPES).toContain(SEALED_SERVICE_RPC_CAPSULE_TYPE)
  })

  test('coordination-service RELAY_ALLOWED_TYPES includes sealed_service_rpc_v1', () => {
    const src = readFileSync(coordinationServer, 'utf8')
    const line = src.split('\n').find((l) => l.includes('RELAY_ALLOWED_TYPES')) ?? ''
    expect(line).toContain(SEALED_SERVICE_RPC_CAPSULE_TYPE)
  })

  test('relay allowlist still excludes critical_job and ingestion_poll plaintext types', () => {
    for (const t of COORDINATION_RELAY_ALLOWED_CAPSULE_TYPES) {
      expect(t.startsWith('critical_job')).toBe(false)
      expect(t.startsWith('ingestion_poll')).toBe(false)
    }
    const src = readFileSync(coordinationServer, 'utf8')
    const line = src.split('\n').find((l) => l.includes('RELAY_ALLOWED_TYPES')) ?? ''
    expect(line).not.toContain('ingestion_poll')
    expect(line).not.toContain('critical_job')
  })
})

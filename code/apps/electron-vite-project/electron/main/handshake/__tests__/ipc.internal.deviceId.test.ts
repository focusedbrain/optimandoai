import { describe, test, expect, vi, beforeEach } from 'vitest'
import * as orchestratorModeStore from '../orchestrator/orchestratorModeStore'

vi.mock('../orchestrator/orchestratorModeStore', () => ({
  getInstanceId: vi.fn(() => undefined),
}))

vi.mock('../device-keys/deviceKeyStore', () => ({
  getDeviceX25519PublicKey: vi.fn(async () => 'dGVzdC14MjU1MTktcHViLWtleS1iNjQ='),
  getDeviceX25519KeyPair: vi.fn(),
  DeviceKeyNotFoundError: class extends Error {
    code = 'DEVICE_KEY_NOT_FOUND'
  },
}))

import { handleHandshakeRPC, setSSOSessionProvider, _resetSSOSessionProvider } from '../ipc'
import { buildTestSession } from '../sessionFactory'
import { createHandshakeTestDb } from './handshakeTestDb'
import { migrateIngestionTables } from '../../ingestion/persistenceDb'

describe('handshake.initiate internal — no orchestrator device_id', () => {
  beforeEach(() => {
    vi.mocked(orchestratorModeStore.getInstanceId).mockReturnValue(undefined)
    _resetSSOSessionProvider()
  })

  test('fails fast with INTERNAL_ENDPOINT_INCOMPLETE', async () => {
    const db = createHandshakeTestDb()
    migrateIngestionTables(db)
    const session = buildTestSession({
      wrdesk_user_id: 'user-int',
      email: 'user-int@test.com',
      sub: 'user-int',
    })
    setSSOSessionProvider(() => session)

    const result = await handleHandshakeRPC(
      'handshake.initiate',
      {
        receiverUserId: 'user-int',
        receiverEmail: 'user-int@test.com',
        fromAccountId: 'acct',
        handshake_type: 'internal',
        device_role: 'host',
        device_name: 'HostBox',
        counterparty_device_id: 'peer-dev-1',
        counterparty_device_role: 'sandbox',
        counterparty_computer_name: 'SandboxBox',
      },
      db,
    )

    expect((result as any).success).toBe(false)
    const msg = String((result as any).error ?? '')
    expect(msg).toContain('INTERNAL_ENDPOINT_INCOMPLETE')
    expect(msg).toContain('orchestrator device_id')
  })
})

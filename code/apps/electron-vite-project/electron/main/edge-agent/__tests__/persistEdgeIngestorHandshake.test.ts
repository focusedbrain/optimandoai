import { describe, test, expect } from 'vitest'

import { isAllowedRolePairForHandshakeType } from '../../../../../../packages/shared/src/handshake/internalEndpointValidation.js'
import { buildEdgeIngestorHandshakeRecord } from '../persistEdgeIngestorHandshake.js'

describe('persistEdgeIngestorHandshake', () => {
  test('builds edge_ingestor row with host ↔ edge_agent roles', () => {
    expect(isAllowedRolePairForHandshakeType('edge_ingestor', 'host', 'edge_agent')).toBe(true)
    const record = buildEdgeIngestorHandshakeRecord({
      orchestratorSub: 'user@test',
      orchestratorEmail: 'user@test',
      orchestratorWrdeskUserId: 'wr-1',
      orchestratorIss: 'https://sso.test',
      orchestratorPublicKey: 'a'.repeat(64),
      agentPublicKey: 'b'.repeat(64),
      fingerprint: 'aaaa-bbbb-cccc-dddd',
      p2pEndpoint: 'http://203.0.113.1:51249',
      orchestratorP2pAuthToken: '11111111-1111-1111-1111-111111111111',
      agentP2pAuthToken: '22222222-2222-2222-2222-222222222222',
      agentEncryptionPublicKeyB64: 'dGVzdC14MjU1MTktcHViLWtleS1iNjQ=',
    })
    expect(record.handshake_type).toBe('edge_ingestor')
    expect(record.initiator_device_role).toBe('host')
    expect(record.acceptor_device_role).toBe('edge_agent')
    expect(record.p2p_endpoint).toBe('http://203.0.113.1:51249')
    expect(record.local_p2p_auth_token).toBe('11111111-1111-1111-1111-111111111111')
    expect(record.counterparty_p2p_token).toBe('22222222-2222-2222-2222-222222222222')
    expect(record.peer_x25519_public_key_b64).toBe('dGVzdC14MjU1MTktcHViLWtleS1iNjQ=')
  })
})

import { describe, test, expect } from 'vitest'
import {
  buildContextSyncCapsule,
  buildAcceptCapsule,
  InternalCapsuleRelayIdentityError,
} from '../capsuleBuilder'
import { buildTestSession } from '../sessionFactory'
import { generateSigningKeypair } from '../signatureKeys'

const session = buildTestSession({
  wrdesk_user_id: 'user-a',
  email: 'a@example.com',
  sub: 'user-a',
})

const prevHash = 'a'.repeat(64)
const signing = generateSigningKeypair()
const localPub = signing.publicKey
const localPriv = signing.privateKey

describe('capsuleBuilder internal relay wire', () => {
  test('context_sync throws when isInternalHandshake but roles/names missing', () => {
    expect(() =>
      buildContextSyncCapsule(session, {
        handshake_id: 'hs-int-ctx-1',
        counterpartyUserId: 'user-a',
        counterpartyEmail: 'a@example.com',
        last_seq_received: 0,
        last_capsule_hash_received: prevHash,
        local_public_key: localPub,
        local_private_key: localPriv,
        isInternalHandshake: true,
        coordinationSenderDeviceId: 'dev-x',
        coordinationReceiverDeviceId: 'dev-y',
      }),
    ).toThrow(InternalCapsuleRelayIdentityError)
  })

  test('context_sync attaches full internal wire when opts complete', () => {
    const cap = buildContextSyncCapsule(session, {
      handshake_id: 'hs-int-ctx-2',
      counterpartyUserId: 'user-a',
      counterpartyEmail: 'a@example.com',
      last_seq_received: 0,
      last_capsule_hash_received: prevHash,
      local_public_key: localPub,
      local_private_key: localPriv,
      isInternalHandshake: true,
      coordinationSenderDeviceId: 'dev-x',
      coordinationReceiverDeviceId: 'dev-y',
      senderDeviceRole: 'host',
      receiverDeviceRole: 'sandbox',
      senderComputerName: 'HostBox',
      receiverComputerName: 'SandboxBox',
    })
    expect(cap.handshake_type).toBe('internal')
    expect(cap.sender_device_id).toBe('dev-x')
    expect(cap.receiver_device_id).toBe('dev-y')
    expect(cap.sender_device_role).toBe('host')
    expect(cap.receiver_device_role).toBe('sandbox')
    expect(cap.sender_computer_name).toBe('HostBox')
    expect(cap.receiver_computer_name).toBe('SandboxBox')
  })

  test('accept throws when isInternalHandshake but wire metadata incomplete', () => {
    expect(() =>
      buildAcceptCapsule(session, {
        handshake_id: 'hs-int-acc',
        initiatorUserId: 'user-a',
        initiatorEmail: 'a@example.com',
        sharing_mode: 'receive-only',
        initiatorCoordinationDeviceId: 'peer-dev',
        isInternalHandshake: true,
      }),
    ).toThrow(InternalCapsuleRelayIdentityError)
  })
})

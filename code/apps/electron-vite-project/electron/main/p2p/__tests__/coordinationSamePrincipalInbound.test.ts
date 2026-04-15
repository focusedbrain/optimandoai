/**
 * Internal handshake — same-principal multi-device inbound coordination (WS push).
 * Tests the pure skip decision used by coordinationWs (no `ws` import).
 */

import { describe, test, expect } from 'vitest'
import { computeSamePrincipalCoordinationSkipOwn } from '../coordinationSamePrincipalInbound'

describe('computeSamePrincipalCoordinationSkipOwn — internal multi-device inbound', () => {
  const hs = 'hs-internal-01'

  test('1) non-internal record: preserve legacy skip (same-principal guard unchanged)', () => {
    expect(
      computeSamePrincipalCoordinationSkipOwn({
        hasDb: true,
        handshakeId: hs,
        record: { handshake_type: 'standard' },
        capsuleSenderDeviceId: 'device-peer',
        localDeviceId: 'device-local',
      }),
    ).toBe(true)

    expect(
      computeSamePrincipalCoordinationSkipOwn({
        hasDb: true,
        handshakeId: hs,
        record: { handshake_type: null },
        capsuleSenderDeviceId: 'a',
        localDeviceId: 'b',
      }),
    ).toBe(true)
  })

  test('2) internal + same principal path + same device id => skip (echo)', () => {
    expect(
      computeSamePrincipalCoordinationSkipOwn({
        hasDb: true,
        handshakeId: hs,
        record: { handshake_type: 'internal' },
        capsuleSenderDeviceId: 'HOST-PC',
        localDeviceId: 'HOST-PC',
      }),
    ).toBe(true)
  })

  test('3) internal + same principal + different device id => do not skip (process peer)', () => {
    expect(
      computeSamePrincipalCoordinationSkipOwn({
        hasDb: true,
        handshakeId: hs,
        record: { handshake_type: 'internal' },
        capsuleSenderDeviceId: 'SANDBOX-PC',
        localDeviceId: 'HOST-PC',
      }),
    ).toBe(false)
  })

  test('4) internal + missing sender_device_id => not classified as own echo (caller rejects earlier)', () => {
    expect(
      computeSamePrincipalCoordinationSkipOwn({
        hasDb: true,
        handshakeId: hs,
        record: { handshake_type: 'internal' },
        capsuleSenderDeviceId: '',
        localDeviceId: 'HOST-PC',
      }),
    ).toBe(false)

    expect(
      computeSamePrincipalCoordinationSkipOwn({
        hasDb: true,
        handshakeId: hs,
        record: { handshake_type: 'internal' },
        capsuleSenderDeviceId: '   ',
        localDeviceId: 'HOST-PC',
      }),
    ).toBe(false)
  })

  test('4b) internal + missing local device id => not classified as own echo', () => {
    expect(
      computeSamePrincipalCoordinationSkipOwn({
        hasDb: true,
        handshakeId: hs,
        record: { handshake_type: 'internal' },
        capsuleSenderDeviceId: 'SANDBOX-PC',
        localDeviceId: '',
      }),
    ).toBe(false)
  })

  test('5) record null + wire not internal => legacy skip (relay echo without DB row)', () => {
    expect(
      computeSamePrincipalCoordinationSkipOwn({
        hasDb: true,
        handshakeId: hs,
        record: null,
        capsuleSenderDeviceId: 'SANDBOX-PC',
        localDeviceId: 'HOST-PC',
      }),
    ).toBe(true)
  })

  test('5b) record null + wire internal + distinct devices => do not skip (peer)', () => {
    expect(
      computeSamePrincipalCoordinationSkipOwn({
        hasDb: true,
        handshakeId: hs,
        record: null,
        capsuleSenderDeviceId: 'SANDBOX-PC',
        localDeviceId: 'HOST-PC',
        capsuleHandshakeType: 'internal',
      }),
    ).toBe(false)
  })

  test('5c) record null + wire internal + same device => skip own echo', () => {
    expect(
      computeSamePrincipalCoordinationSkipOwn({
        hasDb: true,
        handshakeId: hs,
        record: null,
        capsuleSenderDeviceId: 'HOST-PC',
        localDeviceId: 'HOST-PC',
        capsuleHandshakeType: 'internal',
      }),
    ).toBe(true)
  })

  test('5d) record null + wire internal + missing capsule device => do not skip', () => {
    expect(
      computeSamePrincipalCoordinationSkipOwn({
        hasDb: true,
        handshakeId: hs,
        record: null,
        capsuleSenderDeviceId: '',
        localDeviceId: 'HOST-PC',
        capsuleHandshakeType: 'internal',
      }),
    ).toBe(false)
  })

  test('edge: no db / unknown handshake id => skip', () => {
    expect(
      computeSamePrincipalCoordinationSkipOwn({
        hasDb: false,
        handshakeId: hs,
        record: { handshake_type: 'internal' },
        capsuleSenderDeviceId: 'A',
        localDeviceId: 'B',
      }),
    ).toBe(true)

    expect(
      computeSamePrincipalCoordinationSkipOwn({
        hasDb: true,
        handshakeId: 'unknown',
        record: { handshake_type: 'internal' },
        capsuleSenderDeviceId: 'A',
        localDeviceId: 'B',
      }),
    ).toBe(true)
  })
})

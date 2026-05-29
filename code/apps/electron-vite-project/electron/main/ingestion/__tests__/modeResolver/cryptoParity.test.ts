/**
 * Pod depackage regression — qBEAP fixtures via depackagePipeline only (no main-process decrypt).
 */

import { describe, test, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'

import { loadFixtures, type QbeapFixture, toBase64, RECEIVER_PRIV, HANDSHAKE_ID } from './fixtures/qbeap/index.js'
import { depackageViaPodPipeline } from './testHelpers/podHarness.js'
import * as handshakeDb from '../../../handshake/db.js'
import type { HandshakeRecord } from '../../../handshake/types.js'

describe('pod depackage pipeline on qBEAP fixtures', () => {
  let fixtures: QbeapFixture[]

  beforeAll(async () => {
    fixtures = await loadFixtures()
  })

  beforeEach(() => {
    vi.spyOn(handshakeDb, 'getHandshakeRecord').mockReturnValue({
      handshake_id: HANDSHAKE_ID,
      local_x25519_private_key_b64: toBase64(RECEIVER_PRIV),
    } as HandshakeRecord)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  for (const name of ['text-only', 'empty-body', 'large-body', 'transport-preview']) {
    test(`fixture: ${name}`, async () => {
      const fixture = fixtures.find((f) => f.name === name)
      expect(fixture).toBeDefined()

      const viaPod = await depackageViaPodPipeline(fixture!.packageJson, {
        x25519_priv_b64: fixture!.receiverPrivB64,
      })
      expect(viaPod).not.toBeNull()
      expect(viaPod!.rawCapsuleJson).toBeTruthy()
      expect(viaPod!.subject).toBe(fixture!.expectedSubject)
      expect(viaPod!.body).toBe(fixture!.expectedBody)
    })
  }
})

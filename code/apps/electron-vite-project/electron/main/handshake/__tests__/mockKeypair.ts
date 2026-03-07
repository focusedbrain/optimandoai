/**
 * Shared test helper for mock handshake keypair fields.
 * Use when creating mock handshake records that need signing keys.
 */

import { generateSigningKeypair } from '../signatureKeys'

const TEST_KEYPAIR = generateSigningKeypair()
const TEST_COUNTERPARTY_KEYPAIR = generateSigningKeypair()

export function mockKeypairFields() {
  return {
    local_public_key: TEST_KEYPAIR.publicKey,
    local_private_key: TEST_KEYPAIR.privateKey,
  }
}

export function mockCounterpartyKeypairFields() {
  return {
    counterparty_public_key: TEST_COUNTERPARTY_KEYPAIR.publicKey,
  }
}

export { TEST_KEYPAIR, TEST_COUNTERPARTY_KEYPAIR }

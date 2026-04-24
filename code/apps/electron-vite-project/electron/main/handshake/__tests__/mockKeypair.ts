/**
 * Shared test helper for mock handshake keypair fields.
 * Use when creating mock handshake records that need signing keys.
 */

import { generateSigningKeypair } from '../signatureKeys'

const TEST_KEYPAIR = generateSigningKeypair()
const TEST_COUNTERPARTY_KEYPAIR = generateSigningKeypair()

/**
 * Mock X25519 public key (32 bytes, base64) for normal `handshake.accept` IPC tests.
 * Same shape as the extension’s `senderX25519PublicKeyB64` / `key_agreement.x25519_public_key_b64`.
 */
export const MOCK_EXTENSION_X25519_PUBLIC_B64 = 'dGVzdC14MjU1MTktcHViLWtleS1iNjQ='

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

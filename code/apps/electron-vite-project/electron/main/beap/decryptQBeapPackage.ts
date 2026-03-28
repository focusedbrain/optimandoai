/**
 * qBEAP package decryption in the Electron main process (Option B).
 *
 * Receiver ML-KEM secrets and device X25519 private keys are held in the extension
 * (storage / vault), not in SQLite. This module is a stub until key material is
 * synced to main — see docs/electron-qbeap-decryption-design.md
 */

export interface DecryptedQBeapContent {
  subject: string
  body: string
  transport_plaintext: string
  attachments: Array<{
    id: string
    filename: string
    contentType: string
    size: number
    bytes: Buffer | null
  }>
  automation?: {
    tags: string[]
    tagSource: string
  }
}

/** @returns null until receiver secrets are available in main (same hybrid derivation as extension). */
export async function decryptQBeapPackage(
  _packageJson: string,
  _handshakeId: string,
  _db: unknown,
): Promise<DecryptedQBeapContent | null> {
  return null
}

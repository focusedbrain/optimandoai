/**
 * Migration Verification Tests
 *
 * Verifies that:
 * - No new code calls old useHandshakeStore mutation methods for handshake ops
 * - No new code uses BEAP_SEND_EMAIL for handshake-based sends
 * - The new RecipientHandshakeSelect uses SelectedHandshakeRecipient (no X25519)
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const EXT_SRC = path.resolve(__dirname, '../..')

function readFile(relPath: string): string {
  const fullPath = path.join(EXT_SRC, relPath)
  if (!fs.existsSync(fullPath)) return ''
  return fs.readFileSync(fullPath, 'utf-8')
}

describe('Migration — old store mutations removed from new code', () => {
  it('T10: new handshakeRpc.ts has no useHandshakeStore import', () => {
    const content = readFile('handshake/handshakeRpc.ts')
    expect(content).not.toContain('useHandshakeStore')
    expect(content).not.toContain('completeHandshakeFromAccept')
    expect(content).not.toContain('createPendingOutgoingFromRequest')
  })

  it('T11: new RecipientHandshakeSelect has no BEAP_SEND_EMAIL', () => {
    const content = readFile('beap-messages/components/RecipientHandshakeSelect.tsx')
    expect(content).not.toContain('BEAP_SEND_EMAIL')
    expect(content).not.toContain('peerX25519PublicKey')
    expect(content).not.toContain('peerMlkem768')
  })

  it('T12: new RecipientHandshakeSelect has no X25519/ML-KEM fields', () => {
    const content = readFile('beap-messages/components/RecipientHandshakeSelect.tsx')
    expect(content).not.toContain('peerX25519PublicKey')
    expect(content).not.toContain('peerPQPublicKey')
    expect(content).not.toContain('localX25519KeyId')
  })

  it('new handshakeRefresh.ts has no BEAP_SEND_EMAIL', () => {
    const content = readFile('beap-builder/handshakeRefresh.ts')
    expect(content).not.toContain('BEAP_SEND_EMAIL')
    expect(content).not.toContain('chrome.runtime.sendMessage')
  })

  it('new useHandshakes.ts reads from backend, not chrome.storage', () => {
    const content = readFile('handshake/useHandshakes.ts')
    expect(content).not.toContain('chrome.storage')
    expect(content).not.toContain('localStorage')
    expect(content).toContain('listHandshakes')
  })

  it('new HandshakeAcceptModal calls handshake.accept RPC, not old store', () => {
    const content = readFile('handshake/components/HandshakeAcceptModal.tsx')
    expect(content).not.toContain('completeHandshakeFromAccept')
    expect(content).not.toContain('useHandshakeStore')
    expect(content).toContain('acceptHandshake')
  })

  it('rpcTypes.ts defines HandshakeRecord without X25519', () => {
    const content = readFile('handshake/rpcTypes.ts')
    expect(content).toContain('HandshakeRecord')
    expect(content).toContain('counterparty_email')
    expect(content).toContain('counterparty_user_id')
    expect(content).not.toContain('peerX25519PublicKey')
    expect(content).not.toContain('peerMlkem768')
  })
})

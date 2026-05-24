/**
 * Host key mismatch modal — P4.5.13 UI tests.
 */

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { HostKeyMismatchModal } from '../HostKeyMismatchModal.js'
import type { HostKeyMismatchPayload } from '../hostKeyMismatchTypes.js'

const samplePayload: HostKeyMismatchPayload = {
  code: 'HOST_KEY_MISMATCH',
  host: 'edge.example',
  port: 22,
  key_type: 'ssh-ed25519',
  stored_fingerprint: 'aaa',
  observed_fingerprint: 'bbb',
  stored_fingerprint_display: 'SHA256:stored',
  observed_fingerprint_display: 'SHA256:observed',
  message: 'SSH host key changed for edge.example:22',
}

describe('HostKeyMismatchModal', () => {
  it('shows both fingerprints and requires TRUST confirmation', () => {
    const html = renderToStaticMarkup(
      <HostKeyMismatchModal
        payload={samplePayload}
        onTrustNewKey={() => undefined}
        onCancel={() => undefined}
      />,
    )
    expect(html).toContain('host-key-mismatch-modal')
    expect(html).toContain('Host key changed for edge.example:22')
    expect(html).toContain('host-key-stored-fingerprint')
    expect(html).toContain('SHA256:stored')
    expect(html).toContain('SHA256:observed')
    expect(html).toContain('host-key-trust-confirm')
    expect(html).toContain('Trust new key and continue')
    expect(html).toMatch(/disabled=/)
  })
})

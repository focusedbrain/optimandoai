import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SyncFailureBanner } from './SyncFailureBanner'
import { DELEGATED_SYNC_MARKER } from '../utils/syncFailureUi'

describe('SyncFailureBanner', () => {
  it('shows informational outbound-only copy for delegated skip, not Live sync failed', () => {
    const delegatedMsg = `${DELEGATED_SYNC_MARKER} (Settings → Email Accounts → add a read-only account on the sandbox machine.)`
    const html = renderToStaticMarkup(
      <SyncFailureBanner
        warnings={[`[acc-1] ${delegatedMsg}`]}
        accounts={[{ id: 'acc-1', email: 'user@gmail.com', provider: 'gmail' }]}
        onUpdateCredentials={() => {}}
        onRemoveAccount={() => {}}
      />,
    )
    expect(html).toContain('Outbound only on this device')
    expect(html).toContain(DELEGATED_SYNC_MARKER)
    expect(html).not.toContain('Live sync failed')
    expect(html).toContain('role="status"')
  })

  it('still shows sync failure alert for genuine auth errors', () => {
    const html = renderToStaticMarkup(
      <SyncFailureBanner
        warnings={['[acc-2] authentication failed']}
        accounts={[{ id: 'acc-2', email: 'imap@web.de', provider: 'imap' }]}
        onUpdateCredentials={() => {}}
        onRemoveAccount={() => {}}
      />,
    )
    expect(html).toContain('Sync issue')
    expect(html).toContain('Authentication failed')
    expect(html).toContain('role="alert"')
  })

  it('shows Gmail-specific TLS copy without web.de boilerplate', () => {
    const html = renderToStaticMarkup(
      <SyncFailureBanner
        warnings={['[gmail-1] unable to verify the first certificate']}
        accounts={[{ id: 'gmail-1', email: 'user@gmail.com', provider: 'gmail' }]}
        onUpdateCredentials={() => {}}
        onRemoveAccount={() => {}}
      />,
    )
    expect(html).toContain('user@gmail.com')
    expect(html).toContain('Gmail')
    expect(html).not.toContain('imap.web.de')
    expect(html).not.toContain('For web.de')
  })

  it('shows configured IMAP host for web.de TLS errors', () => {
    const html = renderToStaticMarkup(
      <SyncFailureBanner
        warnings={['[wd-1] TLS handshake failed']}
        accounts={[
          {
            id: 'wd-1',
            email: 'user@web.de',
            provider: 'imap',
            imapHost: 'imap.web.de',
            imapPort: 993,
            imapSecurity: 'ssl',
          },
        ]}
        onUpdateCredentials={() => {}}
        onRemoveAccount={() => {}}
      />,
    )
    expect(html).toContain('user@web.de')
    expect(html).toContain('imap.web.de')
    expect(html).toContain('993')
    expect(html).not.toContain('For web.de use')
  })

  it('shows generic TLS copy when IMAP host is unavailable', () => {
    const html = renderToStaticMarkup(
      <SyncFailureBanner
        warnings={['[unk-1] certificate has expired']}
        accounts={[{ id: 'unk-1', email: 'mystery@example.com', provider: 'imap' }]}
        onUpdateCredentials={() => {}}
        onRemoveAccount={() => {}}
      />,
    )
    expect(html).toContain('mystery@example.com')
    expect(html).toContain('IMAP')
    expect(html).not.toContain('web.de')
    expect(html).not.toContain('imap.web.de')
  })
})

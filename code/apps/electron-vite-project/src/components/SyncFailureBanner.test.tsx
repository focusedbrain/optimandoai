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
})

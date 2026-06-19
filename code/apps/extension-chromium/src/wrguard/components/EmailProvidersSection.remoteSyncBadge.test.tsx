/**
 * PROMPT 5 — RemoteSyncBadge must never show green Smart Sync on sandbox when
 * ingestionStatus is null (WRGuard workspace omits email:getIngestionStatus).
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { EmailProvidersSection, type EmailAccount } from './EmailProvidersSection'

const noop = () => {}

const gmailAccount: EmailAccount = {
  id: 'acc-gmail-1',
  displayName: 'Sandbox Reader',
  email: 'reader@example.com',
  provider: 'gmail',
  status: 'active',
}

function renderProviders(opts: {
  isSandbox?: boolean
  ingestionStatus?: { code: string; thisNodeRole?: 'host' | 'sandbox' } | null
}) {
  return renderToStaticMarkup(
    <EmailProvidersSection
      theme="standard"
      emailAccounts={[gmailAccount]}
      isLoadingEmailAccounts={false}
      selectedEmailAccountId={gmailAccount.id}
      onConnectEmail={noop}
      onDisconnectEmail={noop}
      onSelectEmailAccount={noop}
      onUpdateImapCredentials={noop}
      onSetProcessingPaused={noop}
      onSetDeleteFromProviderOnLocalDelete={noop}
      isSandbox={opts.isSandbox}
      ingestionStatus={opts.ingestionStatus ?? null}
    />,
  )
}

describe('EmailProvidersSection — RemoteSyncBadge sandbox fallback', () => {
  it('shows Headless ingestion on sandbox when ingestionStatus is null', () => {
    const html = renderProviders({ isSandbox: true, ingestionStatus: null })
    expect(html).toContain('Headless ingestion')
    expect(html).not.toContain('Smart Sync')
  })

  it('shows green Smart Sync on host when ingestionStatus is null', () => {
    const html = renderProviders({ isSandbox: false, ingestionStatus: null })
    expect(html).toContain('Smart Sync')
    expect(html).not.toContain('Headless ingestion')
  })

  it('shows Headless ingestion when ingestionStatus proves sandbox role', () => {
    const html = renderProviders({
      isSandbox: false,
      ingestionStatus: { code: 'OK', thisNodeRole: 'sandbox' },
    })
    expect(html).toContain('Headless ingestion')
    expect(html).not.toContain('Smart Sync')
  })
})

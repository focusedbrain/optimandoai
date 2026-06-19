/**
 * PROMPT 3 — dedicated sandbox hides local Sync / Auto controls.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import EmailInboxSyncControls from './EmailInboxSyncControls'
import EmailInboxToolbar from './EmailInboxToolbar'
import { DEDICATED_SANDBOX_HOST_TRIGGERED_STATUS } from '../lib/dedicatedSandboxIngestionUi'

const baseProps = {
  accountSyncWindowDays: 30,
  onSyncWindowChange: vi.fn(),
  primaryAccountId: 'acc-1',
  autoSyncEligibleAccountIds: ['acc-1'],
  autoSyncEnabled: true,
  onToggleAutoSync: vi.fn(),
  onUnifiedSync: vi.fn(),
  syncing: false,
  remoteSyncBusy: false,
  pullOnly: true,
}

describe('EmailInboxSyncControls — dedicated sandbox host-triggered UI', () => {
  it('hides Sync/Pull button, Auto checkbox, and toolbar sync window', () => {
    const html = renderToStaticMarkup(
      <EmailInboxSyncControls {...baseProps} hostTriggeredIngestion />,
    )
    expect(html).toContain(DEDICATED_SANDBOX_HOST_TRIGGERED_STATUS)
    expect(html).toContain('bulk-view-host-triggered-sync-status')
    expect(html).not.toContain('bulk-view-pull-btn')
    expect(html).not.toContain('>Auto<')
    expect(html).not.toContain('bulk-view-toolbar-sync-select')
  })

  it('shows local pull controls on host / non-dedicated paths', () => {
    const html = renderToStaticMarkup(<EmailInboxSyncControls {...baseProps} />)
    expect(html).toContain('bulk-view-pull-btn')
    expect(html).toContain('>Auto<')
    expect(html).toContain('bulk-view-toolbar-sync-select')
    expect(html).not.toContain('bulk-view-host-triggered-sync-status')
  })

  it('sandbox read-only node never advertises remote folder sync in pull title', () => {
    const html = renderToStaticMarkup(
      <EmailInboxSyncControls {...baseProps} readOnlyIngestionNode pullOnly={false} />,
    )
    expect(html).toContain('Smart Sync runs on your host device')
    expect(html).not.toContain('enqueue remote folder sync')
    expect(html).toContain('↻ Pull')
    expect(html).not.toContain('↻ Sync')
  })
})

describe('EmailInboxToolbar — dedicated sandbox mount-render', () => {
  it('renders toolbar to completion with host-triggered ingestion (no crash)', () => {
    expect(() =>
      renderToStaticMarkup(
        <EmailInboxToolbar
          filter={{ filter: 'all', messageKind: 'all', sourceType: 'all' }}
          onFilterChange={vi.fn()}
          tabCounts={{ all: 0, urgent: 0, pending_delete: 0, pending_review: 0, archived: 0 }}
          messageKind="all"
          onMessageKindChange={vi.fn()}
          accounts={[{ id: 'acc-1', email: 'read@sandbox.test' }]}
          autoSyncEnabled
          syncing={false}
          remoteSyncBusy={false}
          onUnifiedSync={vi.fn()}
          onSyncWindowChange={vi.fn()}
          autoSyncEligibleAccountIds={['acc-1']}
          onToggleAutoSync={vi.fn()}
          pullOnly
          hostTriggeredIngestion
          bulkMode={false}
          onBulkModeChange={vi.fn()}
          selectedCount={0}
          onBulkDelete={vi.fn()}
          onBulkArchive={vi.fn()}
        />,
      ),
    ).not.toThrow()
  })

  it('host path still renders Sync/Pull controls', () => {
    const html = renderToStaticMarkup(
      <EmailInboxToolbar
        filter={{ filter: 'all', messageKind: 'all', sourceType: 'all' }}
        onFilterChange={vi.fn()}
        tabCounts={{ all: 1, urgent: 0, pending_delete: 0, pending_review: 0, archived: 0 }}
        messageKind="all"
        onMessageKindChange={vi.fn()}
        accounts={[{ id: 'acc-1', email: 'user@host.test' }]}
        autoSyncEnabled
        syncing={false}
        remoteSyncBusy={false}
        onUnifiedSync={vi.fn()}
        onSyncWindowChange={vi.fn()}
        autoSyncEligibleAccountIds={['acc-1']}
        onToggleAutoSync={vi.fn()}
        pullOnly={false}
        hostTriggeredIngestion={false}
        bulkMode={false}
        onBulkModeChange={vi.fn()}
        selectedCount={0}
        onBulkDelete={vi.fn()}
        onBulkArchive={vi.fn()}
      />,
    )
    expect(html).toContain('bulk-view-pull-btn')
    expect(html).not.toContain('bulk-view-host-triggered-sync-status')
  })
})

describe('EmailInboxView wiring — read-provider setup untouched', () => {
  it('still mounts EmailProvidersSection and passes hostTriggeredIngestion gate', () => {
    const src = readFileSync(join(__dirname, 'EmailInboxView.tsx'), 'utf8')
    expect(src).toContain('EmailProvidersSection')
    expect(src).toContain('hostTriggeredIngestion={isDedicatedSandboxHostTriggered}')
    expect(src).toContain('readOnlyIngestionNode={isSandbox}')
  })
})

/**
 * QuarantinePanel component tests — P5.6.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QuarantinePanelView } from '../QuarantinePanel.js'
import { SandboxViewerModal } from '../../sandbox-orchestrator/SandboxViewerModal.js'
import {
  invokeSandboxOrchestrator,
  _setSandboxPrepareOverrideForTest,
  registerSandboxViewShowHandler,
} from '../../sandbox-orchestrator/openSandboxView.js'
import type { QuarantineDashboardSummary, QuarantineListItem } from '../types.js'

const replicaId = '11111111-1111-4111-8111-111111111111'
const hash = 'a'.repeat(64)

const summary: QuarantineDashboardSummary = {
  total_count: 1,
  by_replica: [{ replica_id: replicaId, count: 1, latest_at: '2026-05-24T12:00:00.000Z' }],
  recent_failures: [
    {
      replica_id: replicaId,
      hash,
      quarantined_at: '2026-05-24T12:00:00.000Z',
      failed_role: 'depackager',
    },
  ],
}

const listItem: QuarantineListItem = {
  replica_id: replicaId,
  hash,
  quarantined_at: '2026-05-24T12:00:00.000Z',
  envelope_from: 'sender@example.com',
  envelope_subject_filtered: 'Test subject line',
  failed_role: 'depackager',
  report_filename: '2026-05-24-report.json',
}

describe('QuarantinePanelView', () => {
  it('renders per-replica quarantine counts with mock data', () => {
    const html = renderToStaticMarkup(
      <QuarantinePanelView
        summary={summary}
        listItems={[listItem]}
        selectedReplicaId={replicaId}
        onSelectReplica={() => undefined}
        onRefreshList={async () => undefined}
        onDiscard={async () => ({ ok: true })}
      />,
    )
    expect(html).toContain('edge-dashboard-quarantine')
    expect(html).toContain('1 message quarantined')
    expect(html).toContain('sender@example.com')
    expect(html).toContain('sender-reported')
    expect(html).not.toContain('dangerouslySetInnerHTML')
  })

  it('requires typed confirmation before discard submit is enabled', () => {
    const html = renderToStaticMarkup(
      <QuarantinePanelView
        summary={summary}
        listItems={[listItem]}
        selectedReplicaId={replicaId}
        onSelectReplica={() => undefined}
        onRefreshList={async () => undefined}
        onDiscard={async () => ({ ok: true })}
        initialDiscardItem={listItem}
      />,
    )
    expect(html).toContain('quarantine-discard-modal')
    expect(html).toContain('disabled')
    expect(html).toContain('Type the sender-reported address or full subject')
  })
})

describe('sandbox orchestrator invoke from quarantine actions', () => {
  beforeEach(() => {
    registerSandboxViewShowHandler(() => undefined)
  })

  afterEach(() => {
    _setSandboxPrepareOverrideForTest(null)
    registerSandboxViewShowHandler(null)
  })

  it('invokes diagnostic_report mode for view report action', async () => {
    const prepare = vi.fn(async () => ({ ok: true, textContent: '{"report_v":1}' }))
    _setSandboxPrepareOverrideForTest(prepare)

    const result = await invokeSandboxOrchestrator('diagnostic_report', replicaId, hash)
    expect(result.ok).toBe(true)
    expect(prepare).toHaveBeenCalledWith({
      mode: 'diagnostic_report',
      replicaId,
      hash,
    })
  })

  it('invokes raw_email_body mode for view body action', async () => {
    const prepare = vi.fn(async () => ({ ok: true, textContent: 'From: test@example.com' }))
    _setSandboxPrepareOverrideForTest(prepare)

    const result = await invokeSandboxOrchestrator('raw_email_body', replicaId, hash)
    expect(result.ok).toBe(true)
    expect(prepare).toHaveBeenCalledWith({
      mode: 'raw_email_body',
      replicaId,
      hash,
    })
  })
})

describe('sandbox audit styling snapshots', () => {
  it('SandboxViewerModal uses monospace muted styling, not inbox cards', () => {
    const html = renderToStaticMarkup(
      <SandboxViewerModal
        view={{
          mode: 'diagnostic_report',
          title: 'Diagnostic Report',
          textContent: '{\n  "report_v": 1\n}',
        }}
        onClose={() => undefined}
      />,
    )
    expect(html).toMatchSnapshot()
    expect(html).toContain('sandbox-viewer-modal')
    expect(html).toContain('Diagnostic Report')
    expect(html).toContain('ui-monospace')
    expect(html).not.toContain('dangerouslySetInnerHTML')
  })

  it('QuarantinePanel uses monospace muted palette', () => {
    const html = renderToStaticMarkup(
      <QuarantinePanelView
        summary={summary}
        listItems={[listItem]}
        selectedReplicaId={replicaId}
        onSelectReplica={() => undefined}
        onRefreshList={async () => undefined}
      />,
    )
    expect(html).toMatchSnapshot()
    expect(html).toContain('#f4f4f5')
    expect(html).toContain('ui-monospace')
  })
})

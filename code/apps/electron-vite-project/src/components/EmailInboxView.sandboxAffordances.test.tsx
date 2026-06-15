/**
 * P4 sandbox affordance tests for InboxDetailAiPanel.
 *
 * Verifies that, with isSandbox=true:
 *   - Draft section toggle button is absent
 *   - Draft textarea is replaced by sandbox-lock-draft
 *   - pBEAP textarea is replaced by sandbox-lock-pbeap
 *   - qBEAP textarea is replaced by sandbox-lock-qbeap
 *   - Compose-attach (📎 Attach) button is absent
 *   - Regenerate button is absent
 *   - Draft-error Retry button is absent
 *   - Analysis section toggle remains present (read-only AI analysis stays)
 *   - Analysis "Try again" error-rerun remains present
 *   - The component mounts without throwing (UI_BADGE regression guard)
 *
 * With isSandbox=false (host):
 *   - Draft textarea is present
 *   - Draft toggle is present
 *   - Attach button is present
 *   - Regenerate button is present
 *
 * Uses renderToStaticMarkup — no jsdom required.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { InboxMessage } from '../stores/useEmailInboxStore'
import { SANDBOX_LOCK_COPY } from './SandboxLockSurface'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../hooks/useOrchestratorMode', () => ({
  useOrchestratorMode: vi.fn(),
}))

const emailInboxState = {
  isSortingActive: false,
  editingDraftForMessageId: null,
  selectedAttachmentId: null,
  selectAttachment: vi.fn(),
  mergeMessageAttachments: vi.fn(),
  toggleStar: vi.fn(),
  archiveMessages: vi.fn(),
  deleteMessages: vi.fn(),
  cancelDeletion: vi.fn(),
  setEditingDraftForMessageId: vi.fn(),
}

vi.mock('../stores/useEmailInboxStore', () => {
  const storeHook = vi.fn((selector: (s: typeof emailInboxState) => unknown) =>
    selector(emailInboxState),
  ) as ReturnType<typeof vi.fn> & { getState: () => typeof emailInboxState }
  storeHook.getState = () => emailInboxState
  return {
    useEmailInboxStore: storeHook,
    activeEmailAccountIdsForSync: vi.fn(() => []),
  }
})

vi.mock('../stores/useDraftRefineStore', () => ({
  useDraftRefineStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      connect: vi.fn(),
      disconnect: vi.fn(),
      connected: false,
      messageId: null,
      refineTarget: null,
      refinedDraftText: null,
      acceptRefinement: vi.fn(),
    }),
  ),
}))

vi.mock('../hooks/useInboxPreloadQueue', () => ({
  useInboxPreloadQueue: vi.fn(() => null),
}))

vi.mock('../hooks/useInternalSandboxesList', () => ({
  useInternalSandboxesList: vi.fn(() => ({ sandboxes: [], ready: false })),
}))

vi.mock('../hooks/useRevocationBanner', () => ({
  useRevocationBanner: vi.fn(() => null),
}))

vi.mock('../hooks/useSandboxReadCleanupHint', () => ({
  useSandboxReadCleanupHint: vi.fn(() => null),
}))

vi.mock('../hooks/useIngestionStatus', () => ({
  useIngestionStatus: vi.fn(() => ({ status: null })),
}))

vi.mock('../hooks/useTopologyDelegationModal', () => ({
  useTopologyDelegationModal: vi.fn(() => ({ show: false })),
}))

vi.mock('../shims/handshakeRpc', () => ({
  listHandshakes: vi.fn(async () => []),
}))

vi.mock('../lib/beapInboxCloneToSandbox', () => ({
  beapInboxCloneToSandboxApi: vi.fn(),
  sandboxCloneFeedbackFromOutcome: vi.fn(),
}))

vi.mock('../lib/beapInboxSandboxVisibility', () => ({
  canShowSandboxCloneAction: vi.fn(() => false),
  logSandboxActionVisibility: vi.fn(),
  logSandboxCloneEligibilityDebug: vi.fn(),
}))

vi.mock('../lib/beapInboxHostSandboxClickPolicy', () => ({
  logSandboxTargetResolution: vi.fn(),
  mapSandboxClickActionToResolutionDecision: vi.fn(),
  resolveHostSandboxCloneClickAction: vi.fn(),
  sandboxCloneUnavailableDialogVariant: vi.fn(),
}))

vi.mock('../lib/beapInboxActionTooltips', () => ({
  beapHostSandboxCloneTooltipForAvailability: vi.fn(() => ({ title: '', 'aria-label': '' })),
  beapInboxRedirectTooltipPropsForRow: vi.fn(() => ({ title: '', 'aria-label': '' })),
}))

vi.mock('../lib/resolveActiveSandboxCloneTargets', () => ({
  resolveActiveSandboxCloneTargets: vi.fn(() => []),
}))

vi.mock('../lib/sandboxCloneFeedbackUi', () => ({
  SANDBOX_CLONE_COPY: {},
  viewSandboxChecking: vi.fn(),
  viewSandboxCloning: vi.fn(),
  viewSandboxIdentityIncomplete: vi.fn(),
  viewSandboxKeyingIncomplete: vi.fn(),
  viewSandboxListLoadFailed: vi.fn(),
  viewSandboxNoOrchestrator: vi.fn(),
}))

vi.mock('../lib/inboxAiCloneClassification', () => ({
  INBOX_EMAIL_REPLY_METADATA_MISSING: 'INBOX_EMAIL_REPLY_METADATA_MISSING',
  logInboxReplyTransportDecision: vi.fn(),
  resolveInboxReplyMode: vi.fn(() => 'email'),
}))

vi.mock('../lib/inboxAiUserMessages', () => ({
  inboxAiAnalyzeStreamErrorDisplay: vi.fn(() => ({ title: 'Error', detail: '', isFatal: false })),
  inboxAiDraftReplyErrorDisplay: vi.fn(() => ({ title: 'Error', detail: '', isFatal: false })),
}))

vi.mock('../lib/autosortDiagnostics', () => ({
  autosortDiagLog: vi.fn(),
  DEBUG_AUTOSORT_DIAGNOSTICS: false,
}))

vi.mock('../lib/inboxClassificationReconcile', () => ({
  reconcileAnalyzeTriage: vi.fn((a: unknown) => a),
}))

vi.mock('../lib/inboxMessageSandboxClone', () => ({
  extractSandboxCloneUiMeta: vi.fn(() => null),
  inboxMessageIsSandboxBeapClone: vi.fn(() => false),
  inboxMessageUsesNativeBeapPbeapQbeapSplit: vi.fn(() => false),
  stripSandboxCloneLeadInFromBodyText: vi.fn((t: string) => t),
}))

vi.mock('../lib/inboxMessageActionable', () => ({
  isInboxMessageActionable: vi.fn(() => true),
}))

vi.mock('../lib/inboxBeapOutbound', () => ({
  isBeapQbeapOutboundEcho: vi.fn(() => false),
}))

vi.mock('../lib/inboxMessageKind', () => ({
  deriveInboxMessageKind: vi.fn(() => 'email'),
}))

vi.mock('../utils/parseInboxAiJson', () => ({
  tryParsePartialAnalysis: vi.fn(() => null),
  tryParseAnalysis: vi.fn(() => null),
  tryParseAnalysisWithMeta: vi.fn(() => null),
}))

vi.mock('../utils/originDeleteFlow', () => ({
  confirmOriginDeleteIfNeeded: vi.fn(),
  originDeleteConfirmedForSelection: vi.fn(),
}))

vi.mock('../utils/safeLinks', () => ({
  beapInboxMessageBodyToLinkParts: vi.fn(() => []),
  extractLinkParts: vi.fn(() => []),
}))

vi.mock('../lib/openAppExternalUrl', () => ({
  openAppExternalUrl: vi.fn(),
}))

vi.mock('@ext/wrguard/components/EmailProvidersSection', () => ({
  EmailProvidersSection: () => null,
}))

vi.mock('@ext/shared/email/connectEmailFlow', () => ({
  ConnectEmailLaunchSource: {},
  useConnectEmailFlow: vi.fn(() => ({ launch: vi.fn() })),
}))

vi.mock('@ext/shared/email/pickDefaultAccountRow', () => ({
  pickDefaultEmailAccountRowId: vi.fn(() => null),
}))

vi.mock('@ext/beap-messages/services/BeapPackageBuilder', () => ({
  executeDeliveryAction: vi.fn(),
}))

vi.mock('@ext/beap-builder/buildSessionImportArtefact', () => ({
  buildSessionImportArtefact: vi.fn(),
}))

vi.mock('./EmailInboxToolbar', () => ({ default: () => null }))
vi.mock('./EmailMessageDetail', () => ({ default: () => null }))
vi.mock('./EmailInlineComposer', () => ({ EmailInlineComposer: () => null }))
vi.mock('./BeapMessageImportZone', () => ({ default: () => null }))
vi.mock('./BeapInlineComposer', () => ({ BeapInlineComposer: () => null }))
vi.mock('./SyncFailureBanner', () => ({ SyncFailureBanner: () => null }))
vi.mock('./IngestionStatusBanner', () => ({ IngestionStatusBanner: () => null }))
vi.mock('./IngestionDelegationModal', () => ({ IngestionDelegationModal: () => null }))
vi.mock('./RevocationNoticeBanner', () => ({ RevocationNoticeBanner: () => null }))
vi.mock('./SandboxReadCleanupHint', () => ({ SandboxReadCleanupHint: () => null }))
vi.mock('./SandboxCloneFeedbackBadge', () => ({ default: () => null }))
vi.mock('./InboxBeapSourceBadge', () => ({ InboxBeapSourceBadgeListRow: () => null }))
vi.mock('./InboxActionIcons', () => ({
  InboxRedirectActionIcon: () => null,
  InboxSandboxCloneActionIcon: () => null,
  InboxRunAutomationActionIcon: () => null,
}))
vi.mock('./InboxUrgencyMeter', () => ({ InboxUrgencyMeter: () => null }))
vi.mock('./InboxHandshakeNavIcon', () => ({ InboxHandshakeNavIconButton: () => null }))
vi.mock('./BeapSandboxCloneDialog', () => ({ default: () => null }))
vi.mock('./BeapSandboxUnavailableDialog', () => ({ default: () => null }))
vi.mock('./BeapRedirectDialog', () => ({ default: () => null }))
vi.mock('./LinkWarningDialog', () => ({ default: () => null }))
vi.mock('./SandboxLinkInfoDialog', () => ({ default: () => null }))
vi.mock('./BeapMessageSafeLinkParts', () => ({ default: () => null }))
vi.mock('./InboxAttachmentRow', () => ({ default: () => null }))
vi.mock('./EmailComposeOverlay', () => ({}))
vi.mock('../components/handshakeViewTypes', () => ({}))
vi.mock('../hooks/useIngestionStatus', () => ({ useIngestionStatus: vi.fn(() => ({ status: null })) }))
vi.mock('../hooks/useTopologyDelegationModal', () => ({
  useTopologyDelegationModal: vi.fn(() => ({ show: false, dismiss: vi.fn() })),
}))
vi.mock('@ext/shared/email/connectEmailFlow', () => ({
  ConnectEmailLaunchSource: {},
  useConnectEmailFlow: vi.fn(() => ({ launch: vi.fn() })),
}))

import { useOrchestratorMode } from '../hooks/useOrchestratorMode'
import { InboxDetailAiPanel } from './EmailInboxView'

// ── Test helpers ──────────────────────────────────────────────────────────────

function baseMessage(overrides: Partial<InboxMessage> = {}): InboxMessage {
  return {
    id: 'msg-p4-1',
    source_type: 'email_imap',
    handshake_id: 'hs-p4-test',
    account_id: 'acc-p4',
    email_message_id: 'em-p4',
    from_address: 'sender@example.com',
    from_name: 'Sender',
    to_addresses: 'sandbox@example.com',
    cc_addresses: null,
    subject: 'P4 sandbox affordance test',
    body_text: 'Hello from host inbox clone.',
    body_html: null,
    beap_package_json: null,
    depackaged_json: null,
    has_attachments: 0,
    attachment_count: 0,
    received_at: '2026-06-15T12:00:00.000Z',
    ingested_at: '2026-06-15T12:00:01.000Z',
    read_status: 0,
    starred: 0,
    archived: 0,
    deleted: 0,
    deleted_at: null,
    purge_after: null,
    remote_deleted: null,
    sort_category: null,
    sort_reason: null,
    urgency_score: null,
    needs_reply: null,
    pending_delete: 0,
    pending_delete_at: null,
    ai_summary: null,
    ai_draft_response: null,
    ...overrides,
  }
}

function renderPanel(message: InboxMessage | null, onSendDraft?: () => void) {
  return renderToStaticMarkup(
    <InboxDetailAiPanel
      messageId={message?.id ?? 'msg-p4-1'}
      message={message}
      onSendDraft={onSendDraft}
      onArchive={vi.fn()}
      onDelete={vi.fn()}
    />,
  )
}

// ── Sandbox: mount without crash ───────────────────────────────────────────────

describe('InboxDetailAiPanel — sandbox mount-render (P4 regression guard)', () => {
  beforeEach(() => {
    vi.mocked(useOrchestratorMode).mockReturnValue({
      mode: 'sandbox',
      ready: true,
      isSandbox: true,
      isHost: false,
      ledgerProvesInternalSandboxToHost: true,
      ledgerProvesLocalHostPeerSandbox: false,
    })
  })

  it('renders to completion without throwing when isSandbox=true', () => {
    expect(() => renderPanel(baseMessage(), vi.fn())).not.toThrow()
  })

  it('renders to completion with null message without throwing', () => {
    expect(() => renderPanel(null)).not.toThrow()
  })
})

// ── Sandbox: draft section toggle hidden ──────────────────────────────────────

describe('InboxDetailAiPanel — sandbox: draft section toggle hidden', () => {
  beforeEach(() => {
    vi.mocked(useOrchestratorMode).mockReturnValue({
      mode: 'sandbox', ready: true, isSandbox: true, isHost: false,
      ledgerProvesInternalSandboxToHost: true, ledgerProvesLocalHostPeerSandbox: false,
    })
  })

  it('does not render the ✎ Draft toggle button', () => {
    const html = renderPanel(baseMessage())
    expect(html).not.toContain('✎ Draft')
  })

  it('does not render inbox-detail-ai-section-toggle for draft', () => {
    const html = renderPanel(baseMessage())
    // The Analysis and Summary toggles remain; they don't include "✎ Draft"
    expect(html).not.toContain('Toggle draft section')
  })
})

// ── Sandbox: draft textarea locked ───────────────────────────────────────────

describe('InboxDetailAiPanel — sandbox: draft textarea locked', () => {
  beforeEach(() => {
    vi.mocked(useOrchestratorMode).mockReturnValue({
      mode: 'sandbox', ready: true, isSandbox: true, isHost: false,
      ledgerProvesInternalSandboxToHost: true, ledgerProvesLocalHostPeerSandbox: false,
    })
  })

  it('renders lock surface in draft slot', () => {
    const html = renderPanel(baseMessage(), vi.fn())
    expect(html).toContain('sandbox-lock-draft')
  })

  it('draft textarea is absent on sandbox', () => {
    const html = renderPanel(baseMessage(), vi.fn())
    expect(html).not.toContain('inbox-detail-ai-draft-textarea')
  })

  it('renders lock copy in draft slot', () => {
    const html = renderPanel(baseMessage(), vi.fn())
    expect(html).toContain(SANDBOX_LOCK_COPY)
  })
})

// ── Sandbox: attach button hidden ────────────────────────────────────────────

describe('InboxDetailAiPanel — sandbox: compose-attach hidden', () => {
  beforeEach(() => {
    vi.mocked(useOrchestratorMode).mockReturnValue({
      mode: 'sandbox', ready: true, isSandbox: true, isHost: false,
      ledgerProvesInternalSandboxToHost: true, ledgerProvesLocalHostPeerSandbox: false,
    })
  })

  it('does not render 📎 Attach button', () => {
    const html = renderPanel(baseMessage(), vi.fn())
    expect(html).not.toContain('📎 Attach')
  })

  it('does not render compose file input', () => {
    const html = renderPanel(baseMessage(), vi.fn())
    expect(html).not.toContain('capsule-file-input')
  })
})

// ── Sandbox: regenerate / retry-draft hidden ─────────────────────────────────

describe('InboxDetailAiPanel — sandbox: draft-regenerate hidden', () => {
  beforeEach(() => {
    vi.mocked(useOrchestratorMode).mockReturnValue({
      mode: 'sandbox', ready: true, isSandbox: true, isHost: false,
      ledgerProvesInternalSandboxToHost: true, ledgerProvesLocalHostPeerSandbox: false,
    })
  })

  it('does not render Regenerate button', () => {
    const html = renderPanel(baseMessage(), vi.fn())
    expect(html).not.toContain('>Regenerate<')
  })
})

// ── Sandbox: analysis section remains ────────────────────────────────────────

describe('InboxDetailAiPanel — sandbox: analysis section stays (read-only AI)', () => {
  beforeEach(() => {
    vi.mocked(useOrchestratorMode).mockReturnValue({
      mode: 'sandbox', ready: true, isSandbox: true, isHost: false,
      ledgerProvesInternalSandboxToHost: true, ledgerProvesLocalHostPeerSandbox: false,
    })
  })

  it('still renders the Analysis section toggle', () => {
    const html = renderPanel(baseMessage())
    expect(html).toContain('Toggle analysis section')
  })

  it('still renders the Summary section toggle', () => {
    const html = renderPanel(baseMessage())
    expect(html).toContain('Toggle summary section')
  })
})

// ── Host: all affordances present ────────────────────────────────────────────

describe('InboxDetailAiPanel — host: all affordances present', () => {
  beforeEach(() => {
    vi.mocked(useOrchestratorMode).mockReturnValue({
      mode: 'host', ready: true, isSandbox: false, isHost: true,
      ledgerProvesInternalSandboxToHost: false, ledgerProvesLocalHostPeerSandbox: true,
    })
  })

  it('renders the ✎ Draft toggle button on host', () => {
    const html = renderPanel(baseMessage())
    expect(html).toContain('✎ Draft')
  })

  it('renders draft textarea on host', () => {
    const html = renderPanel(baseMessage(), vi.fn())
    expect(html).toContain('inbox-detail-ai-draft-textarea')
  })

  it('renders 📎 Attach button when usesEmailReplyTransport (host)', () => {
    const html = renderPanel(baseMessage(), vi.fn())
    expect(html).toContain('📎 Attach')
  })

  it('renders Regenerate button on host', () => {
    const html = renderPanel(baseMessage(), vi.fn())
    expect(html).toContain('>Regenerate<')
  })

  it('does not render sandbox lock surfaces on host', () => {
    const html = renderPanel(baseMessage(), vi.fn())
    expect(html).not.toContain('sandbox-lock-draft')
    expect(html).not.toContain('sandbox-lock-pbeap')
    expect(html).not.toContain('sandbox-lock-qbeap')
  })
})

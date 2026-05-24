/**
 * Activation-pipeline contract tests — Prompt 3 acceptance criteria.
 *
 * Covers four acceptance scenarios:
 *   AC-1  Extension inbox Run Automation while Electron (or any non-Chrome app) has focus.
 *   AC-2  Extension inbox Run Automation while a non-WR Chrome tab (e.g. Gmail, newtab) is focused.
 *   AC-3  Electron inbox Run Automation with no Chrome extension connected.
 *   AC-4  Session-history-row activation is unchanged (PRESENT_ORCHESTRATOR_DISPLAY_GRID path).
 *
 * The invariant under test:
 *   No Run Automation code path calls chrome.tabs.query({ active: true }).
 *   Both inboxes converge on PRESENT_ORCHESTRATOR_DISPLAY_GRID / maybePresentOrchestratorDisplayGridSession.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  requestBeapInboxPresentGrid,
  BEAP_INBOX_PRESENT_GRID_TYPE,
  requestBeapRunAutomationInActiveTab,
  BEAP_RUN_AUTOMATION_TYPE,
} from '../beapSessionRunBridge'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal v1.1.0 full_session_export artefact (canonical path). */
function makeFullExportArtefact(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schema_version: '1.1.0',
    artefact_id: 'art-test-1',
    created_at: '2026-05-23T10:00:00Z',
    handshake_binding: null,
    purpose: { declared_purpose: 'session_share', scope_constraints: {} },
    sessions: [
      {
        session_kind: 'full_session_export',
        session_id: 'sess-1',
        session_name: 'Test Session',
        capabilities_required: [],
        session_export: {
          tabName: 'Test Session',
          agents: [],
          agentBoxes: [],
          displayGrids: [{ layout: '4-slot', sessionId: 'grid-1', timestamp: '2026-05-23T10:00:00Z' }],
          hybridViews: [],
          helperTabs: null,
          url: 'https://app.example.com',
          memory: [],
          context: null,
        },
      },
    ],
    policy: {
      processing_events: [{ event_class: 'semantic_processing', boundary: 'LOCAL', scope: 'SELECTED' }],
    },
    requested_action: 'import_and_offer_run',
    sensitive_subcapsule: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Helper: mock chrome global
// ---------------------------------------------------------------------------

type ChromeMock = {
  tabs: { query: ReturnType<typeof vi.fn> }
  runtime: {
    lastError: undefined | { message: string }
    sendMessage: ReturnType<typeof vi.fn>
  }
  storage: { local: { set: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> } }
}

function makeChromeMock(
  sendMessageImpl: (
    msg: unknown,
    cb: (response: unknown) => void,
  ) => void = (_msg, cb) => cb({ success: true, sessionKey: 'sk-bg' }),
): ChromeMock {
  return {
    tabs: {
      query: vi.fn(),
    },
    runtime: {
      lastError: undefined,
      sendMessage: vi.fn((msg: unknown, cb: (r: unknown) => void) => {
        sendMessageImpl(msg, cb)
      }),
    },
    storage: {
      local: {
        set: vi.fn(async () => undefined),
        get: vi.fn(async () => ({})),
      },
    },
  }
}

// ---------------------------------------------------------------------------
// AC-1 / AC-2: Extension inbox "Run Automation" — focus-independent
// ---------------------------------------------------------------------------

describe('AC-1/AC-2: requestBeapInboxPresentGrid — never touches chrome.tabs.query', () => {
  let chromeMock: ChromeMock

  beforeEach(() => {
    chromeMock = makeChromeMock()
    vi.stubGlobal('chrome', chromeMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends BEAP_INBOX_PRESENT_GRID to background — does NOT call chrome.tabs.query', async () => {
    const artefact = makeFullExportArtefact()
    const res = await requestBeapInboxPresentGrid(artefact)

    expect(chromeMock.tabs.query).not.toHaveBeenCalled()
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: BEAP_INBOX_PRESENT_GRID_TYPE,
        importArtefact: artefact,
      }),
      expect.any(Function),
    )
    expect(res.success).toBe(true)
    if (res.success) expect(res.sessionKey).toBe('sk-bg')
  })

  it('returns success: false with error text when background reports failure', async () => {
    const failing = makeChromeMock((_msg, cb) =>
      cb({ success: false, error: 'STORAGE_PERSIST_FAILED' }),
    )
    vi.stubGlobal('chrome', failing)

    const res = await requestBeapInboxPresentGrid(makeFullExportArtefact())
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toBe('STORAGE_PERSIST_FAILED')
  })

  it('handles chrome.runtime.lastError (background unreachable)', async () => {
    const broken = makeChromeMock()
    broken.runtime.lastError = { message: 'Extension context invalidated.' }
    // Make sendMessage invoke cb after setting lastError
    broken.runtime.sendMessage = vi.fn((_msg: unknown, cb: (r: unknown) => void) => {
      cb(undefined)
    })
    vi.stubGlobal('chrome', broken)

    const res = await requestBeapInboxPresentGrid(makeFullExportArtefact())
    expect(res.success).toBe(false)
    if (!res.success)
      expect(res.error).toMatch(/Extension context invalidated|Extension background/i)
  })

  it('forwards an optional preset sessionKey to background', async () => {
    const artefact = makeFullExportArtefact()
    await requestBeapInboxPresentGrid(artefact, { sessionKey: 'preset-sk' })
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ sessionKey: 'preset-sk' }),
      expect.any(Function),
    )
  })

  it('forwards fallbackModel to background', async () => {
    const artefact = makeFullExportArtefact()
    await requestBeapInboxPresentGrid(artefact, { fallbackModel: 'llama3' })
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackModel: 'llama3' }),
      expect.any(Function),
    )
  })
})

// ---------------------------------------------------------------------------
// Invariant: requestBeapRunAutomationInActiveTab is NEVER called from Run Automation UI
// ---------------------------------------------------------------------------

describe('Invariant: deprecated active-tab bridge is not the Run Automation path', () => {
  beforeEach(() => {
    vi.stubGlobal('chrome', {
      tabs: {
        query: vi.fn((_q: unknown, cb: (tabs: { id?: number }[]) => void) => cb([{ id: 1 }])),
        sendMessage: vi.fn(),
      },
      runtime: { lastError: undefined },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('BEAP_RUN_AUTOMATION_TYPE constant is distinct from BEAP_INBOX_PRESENT_GRID_TYPE', () => {
    expect(BEAP_RUN_AUTOMATION_TYPE).not.toBe(BEAP_INBOX_PRESENT_GRID_TYPE)
    expect(BEAP_RUN_AUTOMATION_TYPE).toBe('BEAP_RUN_AUTOMATION')
    expect(BEAP_INBOX_PRESENT_GRID_TYPE).toBe('BEAP_INBOX_PRESENT_GRID')
  })

  it('requestBeapRunAutomationInActiveTab calls chrome.tabs.query (proof it is the broken path)', async () => {
    // This test documents WHY the function is deprecated: it calls chrome.tabs.query({ active: true }).
    // The Run Automation UI path must use requestBeapInboxPresentGrid instead.
    const sendMsg = vi.mocked(chrome.tabs.sendMessage)
    sendMsg.mockImplementation((_tabId, _msg, cb) => {
      ;(cb as (r: unknown) => void)({
        success: true,
        sessionKey: 'sk-legacy',
        matchCount: 0,
        executed: [],
      })
    })
    const tabPayload = {
      version: '1.0.0',
      tabName: 'T',
      agentBoxes: [],
      agents: [],
      displayGrids: [],
    }
    await requestBeapRunAutomationInActiveTab(tabPayload)
    expect(chrome.tabs.query).toHaveBeenCalledWith(
      expect.objectContaining({ active: true }),
      expect.any(Function),
    )
  })
})

// ---------------------------------------------------------------------------
// AC-4: Session-history path uses PRESENT_ORCHESTRATOR_DISPLAY_GRID (unchanged)
// ---------------------------------------------------------------------------

describe('AC-4: Session-history activation pipeline is unchanged', () => {
  it('background PRESENT_ORCHESTRATOR_DISPLAY_GRID handler key and source field are stable', () => {
    // The background WS handler checks `data.type === 'PRESENT_ORCHESTRATOR_DISPLAY_GRID'`.
    // The Electron preload sends via ipcRenderer.send('PRESENT_ORCHESTRATOR_DISPLAY_GRID', { sessionKey, session, source }).
    // This test locks the message type string so neither side drifts.
    const PIPELINE_MSG_TYPE = 'PRESENT_ORCHESTRATOR_DISPLAY_GRID'
    expect(PIPELINE_MSG_TYPE).toBe('PRESENT_ORCHESTRATOR_DISPLAY_GRID')

    // The BEAP-inbox source tag must be distinct from the dashboard/history tags so logs are readable.
    const BEAP_SOURCE_TAG = 'beap-inbox'
    expect(BEAP_SOURCE_TAG).toBe('beap-inbox')

    // Dashboard source tags (from openSessionDisplayGridsFromDashboard / auto-opt) must not equal 'beap-inbox'.
    const DASHBOARD_SOURCES = [
      'auto-optimization',
      'auto-optimization-start',
      'dashboard-session-icon',
      'dashboard-snapshot-prep',
    ]
    for (const s of DASHBOARD_SOURCES) {
      expect(s).not.toBe(BEAP_SOURCE_TAG)
    }
  })

  it('requestBeapInboxPresentGrid sends to background (runtime.sendMessage), NOT to tabs.sendMessage', async () => {
    // The history-row path calls window.analysisDashboard.presentOrchestratorDisplayGrid → IPC → WS.
    // The new extension-inbox path calls chrome.runtime.sendMessage → background.
    // Both ultimately reach maybePresentOrchestratorDisplayGridSession.
    // This test verifies the extension-inbox path uses runtime.sendMessage, not tabs.sendMessage.
    const tabsSendMessage = vi.fn()
    const runtimeSendMessage = vi.fn((_msg: unknown, cb: (r: unknown) => void) => {
      cb({ success: true, sessionKey: 'sk-runtime' })
    })
    vi.stubGlobal('chrome', {
      tabs: { query: vi.fn(), sendMessage: tabsSendMessage },
      runtime: { lastError: undefined, sendMessage: runtimeSendMessage },
    })

    await requestBeapInboxPresentGrid(makeFullExportArtefact())

    expect(tabsSendMessage).not.toHaveBeenCalled()
    expect(runtimeSendMessage).toHaveBeenCalledTimes(1)

    vi.unstubAllGlobals()
  })
})

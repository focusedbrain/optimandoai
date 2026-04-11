import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  requestBeapSessionEditInActiveTab,
  BEAP_EDIT_SESSION_IMPORT_TYPE,
} from '../beapSessionEditBridge'
import {
  requestBeapRunAutomationInActiveTab,
  BEAP_RUN_AUTOMATION_TYPE,
} from '../beapSessionRunBridge'

const tabPayload = { version: '1.0.0', tabName: 'T', agentBoxes: [], agents: [], uiState: {} }

describe('BEAP inbox tab bridges', () => {
  beforeEach(() => {
    vi.stubGlobal('chrome', {
      tabs: {
        query: vi.fn((_q: unknown, cb: (tabs: { id?: number }[]) => void) => {
          cb([{ id: 99 }])
        }),
        sendMessage: vi.fn(),
      },
      runtime: { lastError: undefined as string | undefined },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('Edit: invalid payload never calls tabs.query', async () => {
    const query = vi.mocked(chrome.tabs.query)
    const res = await requestBeapSessionEditInActiveTab(null)
    expect(res.success).toBe(false)
    expect(query).not.toHaveBeenCalled()
  })

  it('Edit: sends BEAP_EDIT_SESSION_IMPORT only (not Run)', async () => {
    const send = vi.mocked(chrome.tabs.sendMessage)
    send.mockImplementation((_tabId, message, cb) => {
      expect(message).toMatchObject({ type: BEAP_EDIT_SESSION_IMPORT_TYPE })
      expect(message).not.toMatchObject({ type: BEAP_RUN_AUTOMATION_TYPE })
      ;(cb as (r: unknown) => void)({ success: true, sessionKey: 'sk_edit' })
    })
    const res = await requestBeapSessionEditInActiveTab(tabPayload)
    expect(res.success).toBe(true)
    if (res.success) expect(res.sessionKey).toBe('sk_edit')
  })

  it('Run: invalid payload fails in init phase without sendMessage', async () => {
    const send = vi.mocked(chrome.tabs.sendMessage)
    const res = await requestBeapRunAutomationInActiveTab([1, 2])
    expect(res.success).toBe(false)
    if (!res.success) expect(res.phase).toBe('init')
    expect(send).not.toHaveBeenCalled()
  })

  it('Run: sends BEAP_RUN_AUTOMATION with payload and fallback model', async () => {
    const send = vi.mocked(chrome.tabs.sendMessage)
    send.mockImplementation((_tabId, message, cb) => {
      expect(message).toMatchObject({ type: BEAP_RUN_AUTOMATION_TYPE })
      expect(message).not.toMatchObject({ type: BEAP_EDIT_SESSION_IMPORT_TYPE })
      const data = (message as { data: { importData: unknown; fallbackModel: string } }).data
      expect(data.importData).toEqual(tabPayload)
      expect(typeof data.fallbackModel).toBe('string')
      expect(data.fallbackModel.length).toBeGreaterThan(0)
      ;(cb as (r: unknown) => void)({
        success: true,
        sessionKey: 'sk_run',
        matchCount: 1,
        executed: ['A'],
      })
    })
    const res = await requestBeapRunAutomationInActiveTab(tabPayload, { fallbackModel: 'mistral' })
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.sessionKey).toBe('sk_run')
      expect(res.executed).toEqual(['A'])
    }
  })
})

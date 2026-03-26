import { describe, it, expect, vi, beforeEach } from 'vitest'

const getAccountConfig = vi.fn()
const getAccount = vi.fn()

vi.mock('../gateway', () => ({
  emailGateway: {
    getAccountConfig: (...args: unknown[]) => getAccountConfig(...args),
    getAccount: (...args: unknown[]) => getAccount(...args),
  },
}))

import { syncAccountEmails } from '../syncOrchestrator'

describe('syncAccountEmails — processingPaused', () => {
  beforeEach(() => {
    getAccountConfig.mockReset()
    getAccount.mockReset()
  })

  it('skips provider work with skipReason processing_paused', async () => {
    getAccountConfig.mockReturnValue({ processingPaused: true, provider: 'imap' })
    const r = await syncAccountEmails({} as any, { accountId: 'acc-1' })
    expect(r.ok).toBe(true)
    expect(r.skipReason).toBe('processing_paused')
    expect(r.listedFromProvider).toBe(0)
    expect(r.newMessages).toBe(0)
    expect(r.newInboxMessageIds).toEqual([])
    expect(getAccount).not.toHaveBeenCalled()
  })

  it('legacy / resumed: undefined processingPaused enters sync body (not paused skip)', async () => {
    getAccountConfig.mockReturnValue({ provider: 'gmail' })
    getAccount.mockRejectedValue(new Error('SYNC_BODY_REACHED'))

    const r = await syncAccountEmails({} as any, { accountId: 'acc-legacy' })
    expect(r.skipReason).not.toBe('processing_paused')
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.includes('SYNC_BODY_REACHED'))).toBe(true)
    expect(getAccount).toHaveBeenCalled()
  })

  it('processingPaused false enters sync body (not processing_paused skip)', async () => {
    getAccountConfig.mockReturnValue({ processingPaused: false, provider: 'gmail' })
    getAccount.mockRejectedValue(new Error('SYNC_BODY_REACHED'))

    const r = await syncAccountEmails({} as any, { accountId: 'acc-false' })
    expect(r.skipReason).not.toBe('processing_paused')
    expect(r.ok).toBe(false)
    expect(getAccount).toHaveBeenCalled()
  })
})

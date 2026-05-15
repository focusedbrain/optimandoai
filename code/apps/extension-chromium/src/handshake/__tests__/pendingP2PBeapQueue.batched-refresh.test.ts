/**
 * CPU Runaway Fix G2 — Batched refreshFromMain in P2P Pending Queue
 *
 * Verifies the call-count contract introduced by the G2 fix:
 *
 *   §1  K items pending → refreshFromMain called exactly ONCE, in patch mode,
 *       with exactly K rowIds.
 *   §2  All items fail to merge → refreshFromMain is NOT called at all.
 *   §3  Some items fail to merge → patch call carries only the successful rowIds.
 *   §4  globalProcessing guard — concurrent call returns early without touching store.
 *   §5  refreshFromMain throws → error is swallowed; no uncaught rejection.
 *   §6  cachePackage is still called per-item (in-loop behaviour preserved).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — declared before any import() of the subject module so hoisting works.
// ---------------------------------------------------------------------------

const mockGetPendingP2PBeapMessages = vi.fn()
const mockAckPendingP2PBeap = vi.fn()
const mockGetHandshake = vi.fn()

vi.mock('../handshakeRpc', () => ({
  getPendingP2PBeapMessages: (...a: unknown[]) => mockGetPendingP2PBeapMessages(...a),
  ackPendingP2PBeap: (...a: unknown[]) => mockAckPendingP2PBeap(...a),
  getHandshake: (...a: unknown[]) => mockGetHandshake(...a),
}))

const mockImportBeapMessage = vi.fn()
const mockVerifyImportedMessage = vi.fn()

vi.mock('../../ingress/importPipeline', () => ({
  importBeapMessage: (...a: unknown[]) => mockImportBeapMessage(...a),
  verifyImportedMessage: (...a: unknown[]) => mockVerifyImportedMessage(...a),
}))

const mockMergeDepackagedToElectron = vi.fn()

vi.mock('../../ingress/electronDepackagedSync', () => ({
  mergeDepackagedToElectron: (...a: unknown[]) => mockMergeDepackagedToElectron(...a),
}))

const mockRefreshFromMain = vi.fn()
const mockCachePackage = vi.fn()

vi.mock('../../beap-messages/useBeapInboxStore', () => ({
  useBeapInboxStore: {
    getState: () => ({
      refreshFromMain: mockRefreshFromMain,
      cachePackage: mockCachePackage,
    }),
  },
}))

// ---------------------------------------------------------------------------
// Subject — imported AFTER mocks are registered.
// ---------------------------------------------------------------------------

import { processPendingP2PBeapQueue } from '../pendingP2PBeapQueue'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FAKE_PKG = {
  capsule: { body: 'hello', transport_plaintext: '', attachments: [] },
  artefacts: [],
}

function makePendingItem(idx: number) {
  return { id: `queue-${idx}`, package_json: `{}`, handshake_id: `hs-${idx}` }
}

function makeImportSuccess(idx: number) {
  return { success: true, messageId: `msg-${idx}` }
}

function makeVerifySuccess(idx: number) {
  return {
    success: true,
    sanitisedPackage: FAKE_PKG,
    resolvedHandshakeId: `hs-${idx}`,
  }
}

// Reset all mocks and the globalProcessing state between tests.
// globalProcessing is reset implicitly because each test awaits the full run.
beforeEach(() => {
  vi.clearAllMocks()
  mockGetHandshake.mockRejectedValue(new Error('no hs'))
  mockAckPendingP2PBeap.mockResolvedValue(undefined)
  mockRefreshFromMain.mockResolvedValue(undefined)
  mockCachePackage.mockReturnValue(undefined)
})

// ---------------------------------------------------------------------------
// §1  K items pending → refreshFromMain called exactly once in patch mode
// ---------------------------------------------------------------------------
describe('§1 K items → single patch refresh', () => {
  it('calls refreshFromMain exactly once with all K rowIds when K=50', async () => {
    const K = 50
    const items = Array.from({ length: K }, (_, i) => makePendingItem(i))
    mockGetPendingP2PBeapMessages.mockResolvedValue(items)
    mockImportBeapMessage.mockImplementation((_pkg: string, _src: string) =>
      Promise.resolve(makeImportSuccess(items.findIndex((it) => it.package_json === _pkg))),
    )
    // Use index-based mocks so each item gets its own messageId
    items.forEach((_, i) => {
      mockImportBeapMessage.mockResolvedValueOnce(makeImportSuccess(i))
      mockVerifyImportedMessage.mockResolvedValueOnce(makeVerifySuccess(i))
    })
    mockMergeDepackagedToElectron.mockResolvedValue({ ok: true })

    await processPendingP2PBeapQueue()

    expect(mockRefreshFromMain).toHaveBeenCalledTimes(1)
    const call = mockRefreshFromMain.mock.calls[0][0]
    expect(call).toMatchObject({ kind: 'patch' })
    expect((call as { kind: string; rowIds: string[] }).rowIds).toHaveLength(K)

    const expectedIds = Array.from({ length: K }, (_, i) => `msg-${i}`)
    expect((call as { kind: string; rowIds: string[] }).rowIds).toEqual(expect.arrayContaining(expectedIds))
  })
})

// ---------------------------------------------------------------------------
// §2  All items fail merge → refreshFromMain NOT called
// ---------------------------------------------------------------------------
describe('§2 all merges fail → no refresh', () => {
  it('skips refreshFromMain when every merge returns ok:false', async () => {
    const items = [makePendingItem(0), makePendingItem(1)]
    mockGetPendingP2PBeapMessages.mockResolvedValue(items)
    items.forEach((_, i) => {
      mockImportBeapMessage.mockResolvedValueOnce(makeImportSuccess(i))
      mockVerifyImportedMessage.mockResolvedValueOnce(makeVerifySuccess(i))
    })
    mockMergeDepackagedToElectron.mockResolvedValue({ ok: false, error: 'network error' })

    await processPendingP2PBeapQueue()

    expect(mockRefreshFromMain).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// §3  Partial failure → patch carries only the successful rowIds
// ---------------------------------------------------------------------------
describe('§3 partial merge failure → patch with successful ids only', () => {
  it('includes only successfully merged rowIds in the patch call', async () => {
    const items = [makePendingItem(0), makePendingItem(1), makePendingItem(2)]
    mockGetPendingP2PBeapMessages.mockResolvedValue(items)

    // item 0: import success, verify success, merge ok
    mockImportBeapMessage.mockResolvedValueOnce(makeImportSuccess(0))
    mockVerifyImportedMessage.mockResolvedValueOnce(makeVerifySuccess(0))
    mockMergeDepackagedToElectron.mockResolvedValueOnce({ ok: true })

    // item 1: import success, verify success, merge fails
    mockImportBeapMessage.mockResolvedValueOnce(makeImportSuccess(1))
    mockVerifyImportedMessage.mockResolvedValueOnce(makeVerifySuccess(1))
    mockMergeDepackagedToElectron.mockResolvedValueOnce({ ok: false, error: 'timeout' })

    // item 2: import success, verify success, merge ok
    mockImportBeapMessage.mockResolvedValueOnce(makeImportSuccess(2))
    mockVerifyImportedMessage.mockResolvedValueOnce(makeVerifySuccess(2))
    mockMergeDepackagedToElectron.mockResolvedValueOnce({ ok: true })

    await processPendingP2PBeapQueue()

    expect(mockRefreshFromMain).toHaveBeenCalledTimes(1)
    const call = mockRefreshFromMain.mock.calls[0][0] as { kind: string; rowIds: string[] }
    expect(call.kind).toBe('patch')
    expect(call.rowIds).toEqual(expect.arrayContaining(['msg-0', 'msg-2']))
    expect(call.rowIds).not.toContain('msg-1')
    expect(call.rowIds).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// §4  globalProcessing guard — concurrent call is dropped
// ---------------------------------------------------------------------------
describe('§4 globalProcessing guard', () => {
  it('concurrent call returns immediately without touching the store', async () => {
    let resolveFirst!: () => void
    const firstRunBlocker = new Promise<void>((res) => {
      resolveFirst = res
    })

    mockGetPendingP2PBeapMessages
      .mockResolvedValueOnce([makePendingItem(0)])  // first call
      .mockResolvedValueOnce([makePendingItem(1)])  // second call (should not run)

    mockImportBeapMessage.mockImplementation(() => firstRunBlocker.then(() => makeImportSuccess(0)))
    mockVerifyImportedMessage.mockResolvedValue(makeVerifySuccess(0))
    mockMergeDepackagedToElectron.mockResolvedValue({ ok: true })

    const first = processPendingP2PBeapQueue()
    const second = processPendingP2PBeapQueue() // concurrent — should be dropped

    await second // the dropped run resolves immediately

    // Verify the second call did not query the DB
    expect(mockGetPendingP2PBeapMessages).toHaveBeenCalledTimes(1)

    resolveFirst()
    await first

    // Only the first run should have refreshed
    expect(mockRefreshFromMain).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// §5  refreshFromMain throws → swallowed, no uncaught rejection
// ---------------------------------------------------------------------------
describe('§5 refreshFromMain throws → swallowed', () => {
  it('resolves without throwing when refreshFromMain rejects', async () => {
    mockGetPendingP2PBeapMessages.mockResolvedValue([makePendingItem(0)])
    mockImportBeapMessage.mockResolvedValueOnce(makeImportSuccess(0))
    mockVerifyImportedMessage.mockResolvedValueOnce(makeVerifySuccess(0))
    mockMergeDepackagedToElectron.mockResolvedValue({ ok: true })
    mockRefreshFromMain.mockRejectedValueOnce(new Error('IPC disconnected'))

    await expect(processPendingP2PBeapQueue()).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// §6  cachePackage still called per-item
// ---------------------------------------------------------------------------
describe('§6 cachePackage called per-item', () => {
  it('calls cachePackage for each item that produces a verified package', async () => {
    const K = 3
    const items = Array.from({ length: K }, (_, i) => makePendingItem(i))
    mockGetPendingP2PBeapMessages.mockResolvedValue(items)
    items.forEach((_, i) => {
      mockImportBeapMessage.mockResolvedValueOnce(makeImportSuccess(i))
      mockVerifyImportedMessage.mockResolvedValueOnce(makeVerifySuccess(i))
    })
    mockMergeDepackagedToElectron.mockResolvedValue({ ok: true })

    await processPendingP2PBeapQueue()

    expect(mockCachePackage).toHaveBeenCalledTimes(K)
  })
})

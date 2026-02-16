/**
 * Tests: atomicWriteFileSync crash-safety guarantees.
 *
 * Acceptance criteria:
 *   1. Normal write → writeFileSync(.tmp) + fsyncSync + renameSync called in order.
 *   2. If writeFileSync(.tmp) throws, renameSync is never called (original safe).
 *   3. If fsyncSync throws, renameSync is never called (original safe).
 *   4. If renameSync throws, the original file is not corrupted
 *      (rename is the only step that touches the target path).
 *   5. File descriptor is always closed, even on fsync failure.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock the fs module BEFORE importing the module under test
// ---------------------------------------------------------------------------
vi.mock('fs', () => {
  return {
    writeFileSync: vi.fn(),
    openSync: vi.fn(() => 42),  // fake fd
    fsyncSync: vi.fn(),
    closeSync: vi.fn(),
    renameSync: vi.fn(),
  }
})

import { writeFileSync, openSync, fsyncSync, closeSync, renameSync } from 'fs'
import { atomicWriteFileSync } from './atomicWrite'

const mWriteFile = writeFileSync as ReturnType<typeof vi.fn>
const mOpenSync  = openSync as unknown as ReturnType<typeof vi.fn>
const mFsync     = fsyncSync as ReturnType<typeof vi.fn>
const mClose     = closeSync as ReturnType<typeof vi.fn>
const mRename    = renameSync as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetAllMocks()
  mOpenSync.mockReturnValue(42)
})

// ---------------------------------------------------------------------------
// 1. Happy path
// ---------------------------------------------------------------------------
describe('atomicWriteFileSync', () => {
  it('calls write → fsync → rename in order', () => {
    atomicWriteFileSync('/vault/meta.json', '{"v":2}')

    // writeFileSync to .tmp
    expect(mWriteFile).toHaveBeenCalledOnce()
    expect(mWriteFile.mock.calls[0][0]).toBe('/vault/meta.json.tmp')
    expect(mWriteFile.mock.calls[0][1]).toBe('{"v":2}')
    expect(mWriteFile.mock.calls[0][2]).toEqual({ mode: 0o600 })

    // openSync with r+ for fsync
    expect(mOpenSync).toHaveBeenCalledWith('/vault/meta.json.tmp', 'r+')

    // fsyncSync on the fd
    expect(mFsync).toHaveBeenCalledWith(42)

    // closeSync on the fd
    expect(mClose).toHaveBeenCalledWith(42)

    // renameSync .tmp → target
    expect(mRename).toHaveBeenCalledWith('/vault/meta.json.tmp', '/vault/meta.json')

    // Verify call order: write < open < fsync < close < rename
    const writeOrder  = mWriteFile.mock.invocationCallOrder[0]
    const openOrder   = mOpenSync.mock.invocationCallOrder[0]
    const fsyncOrder  = mFsync.mock.invocationCallOrder[0]
    const closeOrder  = mClose.mock.invocationCallOrder[0]
    const renameOrder = mRename.mock.invocationCallOrder[0]
    expect(writeOrder).toBeLessThan(openOrder)
    expect(openOrder).toBeLessThan(fsyncOrder)
    expect(fsyncOrder).toBeLessThan(closeOrder)
    expect(closeOrder).toBeLessThan(renameOrder)
  })

  // -------------------------------------------------------------------------
  // 2. writeFileSync throws → rename never called → original safe
  // -------------------------------------------------------------------------
  it('does NOT rename if .tmp write fails', () => {
    mWriteFile.mockImplementation(() => { throw new Error('disk full') })

    expect(() => atomicWriteFileSync('/vault/meta.json', '{}')).toThrow('disk full')
    expect(mRename).not.toHaveBeenCalled()
    expect(mFsync).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // 3. fsyncSync throws → rename never called → original safe
  // -------------------------------------------------------------------------
  it('does NOT rename if fsync fails', () => {
    mFsync.mockImplementation(() => { throw new Error('I/O error') })

    expect(() => atomicWriteFileSync('/vault/meta.json', '{}')).toThrow('I/O error')
    expect(mRename).not.toHaveBeenCalled()
    // fd is still closed (finally block)
    expect(mClose).toHaveBeenCalledWith(42)
  })

  // -------------------------------------------------------------------------
  // 4. renameSync throws → original is untouched (rename is atomic)
  // -------------------------------------------------------------------------
  it('throws if rename fails (original untouched by design)', () => {
    mRename.mockImplementation(() => { throw new Error('permission denied') })

    expect(() => atomicWriteFileSync('/vault/meta.json', '{}')).toThrow('permission denied')
    // write + fsync + close all succeeded before rename
    expect(mWriteFile).toHaveBeenCalledOnce()
    expect(mFsync).toHaveBeenCalledOnce()
    expect(mClose).toHaveBeenCalledOnce()
  })

  // -------------------------------------------------------------------------
  // 5. fd is always closed even when fsync throws
  // -------------------------------------------------------------------------
  it('always closes the file descriptor', () => {
    mFsync.mockImplementation(() => { throw new Error('I/O error') })

    expect(() => atomicWriteFileSync('/vault/meta.json', '{}')).toThrow()
    expect(mClose).toHaveBeenCalledWith(42)
  })
})

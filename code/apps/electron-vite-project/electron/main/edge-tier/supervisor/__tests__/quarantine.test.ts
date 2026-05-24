/**
 * Supervisor quarantine pickup tests (P5.5).
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { pickupQuarantineEntries } from '../quarantinePickup.js'
import {
  _setLocalQuarantineRootForTest,
  listLocalQuarantineEntries,
  storeLocalQuarantineEntry,
  cleanupLocalQuarantine,
} from '../quarantineStore.js'

describe('supervisor quarantine pickup (P5.5)', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'supervisor-quarantine-'))
    process.env['WR_DESK_USER_DATA'] = tempDir
    _setLocalQuarantineRootForTest(join(tempDir, 'diagnostic-reports'))
  })

  afterEach(() => {
    delete process.env['WR_DESK_USER_DATA']
    _setLocalQuarantineRootForTest(null)
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('picks up quarantine entry alongside diagnostic report hash', async () => {
    const hash = 'a'.repeat(64)
    const reportJson = JSON.stringify({
      message_under_processing: { sha256_hex: hash },
    })
    const metadata = JSON.stringify({
      hash,
      envelope_from: 'sender@example.com',
      failed_container_role: 'depackager',
      quarantined_at: new Date().toISOString(),
    })
    const rawBytes = JSON.stringify({ iv: '00', tag: '00', ciphertext: 'deadbeef' })

    const mockSsh = {
      run: async (cmd: string) => {
        if (cmd.includes('podman cp')) return { stdout: '', stderr: '', code: 0 }
        if (cmd.includes('metadata.json')) return { stdout: metadata, stderr: '', code: 0 }
        if (cmd.includes('raw_bytes')) return { stdout: rawBytes, stderr: '', code: 0 }
        return { stdout: '', stderr: '', code: 0 }
      },
      uploadContent: async () => undefined,
      disconnect: async () => undefined,
    }

    const result = await pickupQuarantineEntries(
      mockSsh,
      'replica-1',
      'beap-pod-remote-edge-depackager',
      [reportJson],
    )

    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]?.hash).toBe(hash)
    expect(listLocalQuarantineEntries('replica-1')).toHaveLength(1)
  })

  test('cleanupLocalQuarantine removes aged desktop copies', () => {
    const hash = 'b'.repeat(64)
    const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString()
    storeLocalQuarantineEntry(
      'replica-1',
      hash,
      '{"iv":"00","tag":"00","ciphertext":"aa"}',
      JSON.stringify({
        hash,
        envelope_from: 'a@b.com',
        quarantined_at: oldDate,
        failed_container_role: 'mail-fetcher',
      }),
    )

    const removed = cleanupLocalQuarantine(30)
    expect(removed.length).toBe(1)
    expect(listLocalQuarantineEntries('replica-1')).toHaveLength(0)
  })
})

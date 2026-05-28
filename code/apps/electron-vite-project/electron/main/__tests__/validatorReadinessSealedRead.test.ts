/**
 * Regression: inner provider binding for sealed inbox reads and re-seal.
 *
 * Must run without test/setup.ts global mock pod (isolated suite).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'

import {
  bindKeyProvider,
  unbindKeyProvider,
  sealedQuery,
  clearTamperingEvents,
  computeSeal,
} from '../sealed-storage/index.js'
import { deriveLedgerSealKey } from '../sealed-storage/ledgerSealKey.js'
import { ensureValidatorAndSealedStorageReady } from '../validatorReadiness.js'
import { validatorOrchestrator } from '../validation/inProcessValidator.js'
import { deriveTestSealKey } from '../validation/__testUtils__.js'
import { vaultService } from '../vault/service.js'
import {
  createHarnessDb,
  type HarnessDatabase,
} from '../../../../../test/harness/sealed-storage.js'

const OUTER_KEY = deriveLedgerSealKey('validator-readiness-test-session')

vi.mock('../vault/vaultCanon.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../vault/vaultCanon.js')>()
  return {
    ...actual,
    isInnerVaultUnlocked: vi.fn(() => true),
    getHandshakeClassification: vi.fn(() => 'non_confidential' as const),
  }
})

function mockUnlockedVault(): void {
  vi.spyOn(vaultService, 'getStatus').mockReturnValue({
    isUnlocked: true,
    availableVaults: [{ id: 'default' }],
    currentVaultId: 'default',
    legacyUnclaimedVaults: [],
    hiddenForeignVaultCount: 0,
  } as ReturnType<typeof vaultService.getStatus>)
  vi.spyOn(vaultService, 'deriveApplicationKey').mockReturnValue(Buffer.from(deriveTestSealKey()))
}

function hostPodOuterOnlyBinding(): void {
  unbindKeyProvider('inner')
  unbindKeyProvider('outer')
  bindKeyProvider(() => Buffer.from(OUTER_KEY), 'outer')
  clearTamperingEvents()
}

async function sealedReadAfterInnerBind(
  reason: string,
  db: HarnessDatabase,
): Promise<void> {
  expect(db, 'better-sqlite3 harness required for sealed read regression').toBeTruthy()
  if (!db) return

  const result = await ensureValidatorAndSealedStorageReady(reason, undefined, {
    requireInner: true,
  })
  expect(result.ok).toBe(true)
  expect(validatorOrchestrator.getLiveness()).toBe('running')
  expect(sealedQuery).toBeDefined()

  const msgId = randomUUID()
  const canonical = JSON.stringify({ id: msgId, body: 'beap hello' })
  const { seal, seal_input_json } = computeSeal(canonical, msgId, 'inner')

  db
    .prepare(
      `INSERT INTO inbox_messages (id, depackaged_json, seal, seal_input_json, seal_key_source)
       VALUES (?, ?, ?, ?, 'vmk')`,
    )
    .run(msgId, canonical, seal, seal_input_json)

  const rows = sealedQuery(
    db,
    'SELECT id, depackaged_json, seal, seal_input_json FROM inbox_messages WHERE id = ?',
    [msgId],
    'depackaged_json',
  )

  expect(rows).toHaveLength(1)
  expect(rows[0]?.depackaged_json).toBe(canonical)
}

describe('ensureValidatorAndSealedStorageReady — inner binding', () => {
  beforeEach(async () => {
    await validatorOrchestrator.stop().catch(() => undefined)
    hostPodOuterOnlyBinding()
    mockUnlockedVault()
  })

  afterEach(async () => {
    await validatorOrchestrator.stop().catch(() => undefined)
    unbindKeyProvider('inner')
    unbindKeyProvider('outer')
    vi.restoreAllMocks()
  })

  it('starts inner validator when requireInner despite outer-only SSO binding', async () => {
    const result = await ensureValidatorAndSealedStorageReady('test_reseal', undefined, {
      requireInner: true,
    })
    expect(result.ok).toBe(true)
    expect(validatorOrchestrator.getLiveness()).toBe('running')
  })

  it('allows outer-only fast path when requireInner is false and outer is bound', async () => {
    const result = await ensureValidatorAndSealedStorageReady('test_outer_clone', undefined, {
      requireInner: false,
    })
    expect(result.ok).toBe(true)
    expect(validatorOrchestrator.getLiveness()).not.toBe('running')
  })
})

describe('HostPodActive sealed inbox read (outer bound, inner via validator start)', () => {
  let db: HarnessDatabase

  beforeEach(async () => {
    await validatorOrchestrator.stop().catch(() => undefined)
    hostPodOuterOnlyBinding()
    mockUnlockedVault()
    db = createHarnessDb()
  })

  afterEach(async () => {
    await validatorOrchestrator.stop().catch(() => undefined)
    unbindKeyProvider('inner')
    unbindKeyProvider('outer')
    if (db) {
      try {
        db.close()
      } catch {
        /* already closed */
      }
    }
    vi.restoreAllMocks()
  })

  it('reads inner-sealed inbox_messages row after ensureValidator requireInner', async () => {
    await sealedReadAfterInnerBind('host_pod_sealed_read', db)
  })
})

describe('LegacyInProcess sealed read without Podman (inner validator only)', () => {
  let db: HarnessDatabase

  beforeEach(async () => {
    await validatorOrchestrator.stop().catch(() => undefined)
    unbindKeyProvider('inner')
    unbindKeyProvider('outer')
    mockUnlockedVault()
    db = createHarnessDb()
  })

  afterEach(async () => {
    await validatorOrchestrator.stop().catch(() => undefined)
    unbindKeyProvider('inner')
    unbindKeyProvider('outer')
    if (db) {
      try {
        db.close()
      } catch {
        /* already closed */
      }
    }
    vi.restoreAllMocks()
  })

  it('reads inner-sealed inbox_messages without outer ledger key bound', async () => {
    await sealedReadAfterInnerBind('legacy_in_process_read', db)
  })
})

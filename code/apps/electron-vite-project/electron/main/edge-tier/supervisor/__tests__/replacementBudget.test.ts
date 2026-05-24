/**
 * Replacement budget circuit breaker tests (P5.7).
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  checkReplacementAllowed,
  recordReplacementCompleted,
  observeContainerRunning,
  resumeAutomaticRecovery,
  isReplacementExhausted,
  storeReplacementBudgetNotification,
  _resetReplacementBudgetForTest,
  _replacementCountInWindowForTest,
  MAX_REPLACEMENTS,
  WINDOW_SECONDS,
  HEALTHY_PERIOD_SECONDS,
} from '../replacementBudget.js'
import {
  _setSupervisorAuditPathForTest,
  readSupervisorAuditEntries,
  appendSupervisorAudit,
} from '../auditLog.js'

const replicaId = '550e8400-e29b-41d4-a716-446655440000'
const role = 'depackager' as const

describe('replacementBudget (P5.7)', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'replacement-budget-'))
    process.env['WR_DESK_USER_DATA'] = tempDir
    _setSupervisorAuditPathForTest(join(tempDir, 'edge-tier-audit.log'))
    _resetReplacementBudgetForTest()
  })

  afterEach(() => {
    delete process.env['WR_DESK_USER_DATA']
    _setSupervisorAuditPathForTest(null)
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('3 replacements in 60s blocks the next attempt', () => {
    const t0 = 1_000_000
    for (let i = 0; i < MAX_REPLACEMENTS; i++) {
      const allowance = checkReplacementAllowed(replicaId, role, t0 + i * 1000)
      expect(allowance.allowed).toBe(true)
      recordReplacementCompleted(replicaId, role, t0 + i * 1000, true)
    }

    expect(_replacementCountInWindowForTest(replicaId, role, t0 + 5000)).toBe(MAX_REPLACEMENTS)

    const blocked = checkReplacementAllowed(replicaId, role, t0 + 5000)
    expect(blocked.allowed).toBe(false)
    if (!blocked.allowed) {
      expect(blocked.reason).toBe('budget_exhausted')
      expect(blocked.newly_exhausted).toBe(true)
    }
    expect(isReplacementExhausted(replicaId, role)).toBe(true)

    const again = checkReplacementAllowed(replicaId, role, t0 + 6000)
    expect(again.allowed).toBe(false)
    if (!again.allowed) {
      expect(again.reason).toBe('already_exhausted')
    }
  })

  test('3 replacements over 90s allows the third (oldest expired from window)', () => {
    const t0 = 2_000_000
    const stepMs = 30_000

    for (let i = 0; i < 2; i++) {
      const at = t0 + i * stepMs
      expect(checkReplacementAllowed(replicaId, role, at).allowed).toBe(true)
      recordReplacementCompleted(replicaId, role, at, true)
    }

    const thirdAt = t0 + 2 * stepMs
    expect(_replacementCountInWindowForTest(replicaId, role, thirdAt)).toBe(1)

    const thirdAllowance = checkReplacementAllowed(replicaId, role, thirdAt)
    expect(thirdAllowance.allowed).toBe(true)
    recordReplacementCompleted(replicaId, role, thirdAt, true)
    expect(isReplacementExhausted(replicaId, role)).toBe(false)
  })

  test('budget resets on user manual clear', () => {
    const t0 = 3_000_000
    for (let i = 0; i < MAX_REPLACEMENTS; i++) {
      checkReplacementAllowed(replicaId, role, t0 + i * 1000)
      recordReplacementCompleted(replicaId, role, t0 + i * 1000, true)
    }
    checkReplacementAllowed(replicaId, role, t0 + 10_000)
    expect(isReplacementExhausted(replicaId, role)).toBe(true)

    resumeAutomaticRecovery(replicaId, role)
    expect(isReplacementExhausted(replicaId, role)).toBe(false)
    expect(_replacementCountInWindowForTest(replicaId, role, t0 + 11_000)).toBe(0)
    expect(checkReplacementAllowed(replicaId, role, t0 + 11_000).allowed).toBe(true)
  })

  test('healthy period after successful replacement resets budget without clearing notification store separately', () => {
    const t0 = 4_000_000
    recordReplacementCompleted(replicaId, role, t0, true)
    storeReplacementBudgetNotification(replicaId, role, t0)
    checkReplacementAllowed(replicaId, role, t0 + 1000)
    recordReplacementCompleted(replicaId, role, t0 + 1000, true)
    checkReplacementAllowed(replicaId, role, t0 + 2000)
    recordReplacementCompleted(replicaId, role, t0 + 2000, true)
    checkReplacementAllowed(replicaId, role, t0 + 3000)

    expect(isReplacementExhausted(replicaId, role)).toBe(true)

    const healthyStart = t0 + 4000
    observeContainerRunning(replicaId, role, healthyStart)
    const afterHealthy = healthyStart + HEALTHY_PERIOD_SECONDS * 1000
    const reset = observeContainerRunning(replicaId, role, afterHealthy)
    expect(reset).toBe(true)
    expect(isReplacementExhausted(replicaId, role)).toBe(false)
  })

  test('audit log records replacement_budget_exhausted events', () => {
    appendSupervisorAudit({
      event: 'replacement_budget_exhausted',
      replica_id: replicaId,
      container_role: role,
      success: false,
      reason: `max_${MAX_REPLACEMENTS}_in_${WINDOW_SECONDS}s`,
    })

    const auditPath = join(tempDir, 'edge-tier-audit.log')
    expect(existsSync(auditPath)).toBe(true)
    const lines = readFileSync(auditPath, 'utf8').trim().split('\n')
    const parsed = JSON.parse(lines.at(-1)!) as { event: string; container_role: string }
    expect(parsed.event).toBe('replacement_budget_exhausted')
    expect(parsed.container_role).toBe(role)
    expect(readSupervisorAuditEntries().some((e) => e.event === 'replacement_budget_exhausted')).toBe(
      true,
    )
  })
})

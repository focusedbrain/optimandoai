/**
 * Sandbox Process Boundary Tests
 *
 * Verifies:
 *   1. Task enqueued → worker receives and processes (status → processed)
 *   2. Worker returns valid result → host accepts, schema validates
 *   3. Worker returns malformed result → host rejects (fail-closed)
 *   4. Worker crashes → task marked failed, host unaffected
 *   5. No direct worker imports in host code (static scan)
 *   6. Sandbox result cannot trigger tool execution directly
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  enqueueTask,
  consumeResults,
  setTaskProcessor,
  _resetProcessor,
} from '../sandboxClient'
import type { SandboxTask, SandboxResult } from '../types'
import { processTaskInWorker } from '../sandboxWorker'

function createProcessTestDb() {
  const tables: Record<string, any[]> = {
    sandbox_queue: [],
  }
  let idCounter = 1

  return {
    prepare: (sql: string) => ({
      run: (...args: any[]) => {
        if (sql.includes('INSERT OR IGNORE INTO sandbox_queue')) {
          const existing = tables.sandbox_queue.find(r => r.raw_input_hash === args[0])
          if (existing) return { changes: 0 }
          tables.sandbox_queue.push({
            id: idCounter++,
            raw_input_hash: args[0],
            validated_capsule_json: args[1],
            routing_reason: args[2],
            status: 'queued',
            created_at: args[3],
            updated_at: args[4],
            retry_count: 0,
          })
          return { changes: 1 }
        }
        if (sql.includes('UPDATE sandbox_queue SET status')) {
          const item = tables.sandbox_queue.find(r => r.id === args[2])
          if (item) {
            item.status = args[0]
            item.updated_at = args[1]
          }
        }
      },
      get: () => undefined,
      all: (...args: any[]) => {
        if (sql.includes('sandbox_queue') && sql.includes('WHERE status =')) {
          return tables.sandbox_queue
            .filter(r => r.status === args[0])
            .slice(0, args[1] ?? 100)
        }
        return []
      },
    }),
    transaction: (fn: any) => fn,
    _tables: tables,
  }
}

function makeTask(overrides?: Partial<SandboxTask>): SandboxTask {
  return {
    task_id: `task-${Date.now()}`,
    created_at: new Date().toISOString(),
    raw_input_hash: 'a'.repeat(64),
    validated_capsule: { capsule_type: 'internal_draft', schema_version: 1 },
    reason: 'external_draft',
    constraints: {
      network: 'denied',
      filesystem: 'ephemeral',
      time_limit_ms: 30_000,
    },
    ...overrides,
  }
}

// ═══════════════════════════════════════════════════════════════════════

describe('Sandbox Process Boundary', () => {
  afterEach(() => {
    _resetProcessor()
  })

  // Test 1: Task enqueued → worker receives and processes → status processed
  test('1: task enqueued → worker processes → status=processed', async () => {
    setTaskProcessor(async (task) => processTaskInWorker(task))
    const db = createProcessTestDb()
    const task = makeTask()
    enqueueTask(db, task)

    const result = await consumeResults(db, 10)
    expect(result.processed).toBe(1)
    expect(result.results[0].status).toBe('verified')
    expect(db._tables.sandbox_queue[0].status).toBe('processed')
  })

  // Test 2: Worker returns valid result → host accepts, schema validates
  test('2: worker returns valid result → host accepts, schema validates', async () => {
    setTaskProcessor(async (task) => processTaskInWorker(task))
    const db = createProcessTestDb()
    enqueueTask(db, makeTask())

    const result = await consumeResults(db, 10)
    expect(result.processed).toBe(1)
    expect(result.rejected).toBe(0)

    const r = result.results[0]
    expect(typeof r.task_id).toBe('string')
    expect(typeof r.completed_at).toBe('string')
    expect(['verified', 'rejected', 'error']).toContain(r.status)
    expect(Array.isArray(r.findings)).toBe(true)
  })

  // Test 3: Worker returns malformed result → host rejects (fail-closed)
  test('3: worker returns malformed result → host rejects', async () => {
    setTaskProcessor(async (task) => ({
      task_id: task.task_id,
      completed_at: new Date().toISOString(),
      status: 'INVALID_STATUS' as any,
      findings: [],
    }))
    const db = createProcessTestDb()
    enqueueTask(db, makeTask())

    const result = await consumeResults(db, 10)
    expect(result.processed).toBe(0)
    expect(result.rejected).toBe(1)
    expect(db._tables.sandbox_queue[0].status).toBe('failed')
  })

  // Test 4: Worker crashes → task marked failed, host unaffected
  test('4: worker crashes → task marked failed, host unaffected', async () => {
    setTaskProcessor(async () => {
      throw new Error('Simulated worker crash')
    })
    const db = createProcessTestDb()
    enqueueTask(db, makeTask())

    const result = await consumeResults(db, 10)
    expect(result.processed).toBe(0)
    expect(result.rejected).toBe(1)
    expect(db._tables.sandbox_queue[0].status).toBe('failed')
  })

  // Test 5: No direct worker imports in host code (static scan)
  test('5: no direct sandboxWorker imports in host production code', () => {
    const ELECTRON_MAIN_DIR = path.resolve(__dirname, '..', '..')
    const violations: string[] = []

    function collectProdFiles(dir: string): string[] {
      const results: string[] = []
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            if (entry.name === '__tests__' || entry.name === 'node_modules') continue
            results.push(...collectProdFiles(fullPath))
          } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
            results.push(fullPath)
          }
        }
      } catch { /* dir may not exist */ }
      return results
    }

    const allFiles = collectProdFiles(ELECTRON_MAIN_DIR)
    for (const filePath of allFiles) {
      const basename = path.basename(filePath)
      // sandboxProcessBridge.ts does NOT import sandboxWorker — the worker
      // is spawned via fork(path), not via import. Only test files may import
      // processTaskInWorker for unit testing the worker logic.
      if (basename === 'sandboxWorker.ts' || basename === 'sandboxProcessBridge.ts') continue

      const content = fs.readFileSync(filePath, 'utf-8')
      if (/from\s+['"].*sandboxWorker['"]/.test(content) ||
          /import\s*\{[^}]*processTaskInWorker[^}]*\}/.test(content)) {
        violations.push(path.relative(ELECTRON_MAIN_DIR, filePath))
      }
    }

    expect(
      violations,
      `Host files import sandboxWorker directly:\n  ${violations.join('\n  ')}`,
    ).toEqual([])
  })

  // Test 6: Sandbox result cannot trigger tool execution directly
  test('6: sandbox result cannot trigger tool execution directly', async () => {
    setTaskProcessor(async (task) => ({
      task_id: task.task_id,
      completed_at: new Date().toISOString(),
      status: 'verified' as const,
      findings: [],
      output_summary: 'executeToolRequest({tool_name:"dangerous"})',
    }))
    const db = createProcessTestDb()
    enqueueTask(db, makeTask())

    const result = await consumeResults(db, 10)
    expect(result.processed).toBe(1)

    // The result is data only — it's a SandboxResult object.
    // There is no code path from SandboxResult to tool execution
    // without explicitly constructing a ToolRequest and calling
    // executeToolRequest(). Verify the result is inert data.
    const r = result.results[0]
    expect(typeof r.output_summary).toBe('string')
    expect(r).not.toHaveProperty('tool_name')
    expect(r).not.toHaveProperty('parameters')
    expect(r).not.toHaveProperty('handshake_id')
  })
})

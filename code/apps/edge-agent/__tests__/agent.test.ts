import { describe, test, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { generatePairingCode, formatPairingCodeDisplay } from '../src/pairingCode.js'
import { AgentStorage } from '../src/storage.js'
import { rolePolicy, EDGE_ROLE_POLICY_ACCOUNT } from '@repo/role-policy'

describe('edge-agent', () => {
  test('generates 6-digit pairing codes', () => {
    const code = generatePairingCode()
    expect(code).toMatch(/^\d{6}$/)
    expect(formatPairingCodeDisplay(code)).toMatch(/^\d{3}-\d{3}$/)
  })

  test('encrypted storage round-trips state', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'edge-agent-'))
    try {
      const storage = new AgentStorage(dir)
      await storage.saveState({ phase: 'unpaired', ssoSub: 'user-1' })
      const loaded = await storage.loadState()
      expect(loaded.phase).toBe('unpaired')
      expect(loaded.ssoSub).toBe('user-1')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('role policy forbids send on edge agent context', () => {
    const d = rolePolicy.canSend(EDGE_ROLE_POLICY_ACCOUNT, {
      mode: 'EdgeActive',
      context: 'edge_mail_fetcher',
    })
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe('edge_role_send_forbidden')
  })
})

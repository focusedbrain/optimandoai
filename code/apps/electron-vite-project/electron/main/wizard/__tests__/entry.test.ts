/**
 * Wizard entry guard — resume / start-over (A5).
 */

import { describe, test, expect } from 'vitest'

import { INITIAL_WIZARD_STATE } from '../stateMachine.js'
import { buildWizardEntryContext, resumeWizardSetup } from '../entry.js'
import {
  _setSettingsPathForTest,
  type EdgeReplica,
} from '../../edge-tier/settings.js'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const REPLICA: EdgeReplica = {
  host: '203.0.113.10',
  port: 18100,
  edge_pod_id: '11111111-1111-4111-8111-111111111111',
  edge_public_key: 'ed25519:' + 'aa'.repeat(32),
  sso_attestation_jwt: 'stub.jwt',
}

let tempDir = ''

describe('wizard entry context', () => {
  test('setup_in_progress when pending with replica', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'wizard-entry-'))
    _setSettingsPathForTest(join(tempDir, 'edge-tier-settings.json'))
    writeFileSync(
      join(tempDir, 'edge-tier-settings.json'),
      JSON.stringify({
        enabled: 'pending',
        replicas: [REPLICA],
        on_edge_unreachable: 'hold',
        fallback_policy: 'reject',
        native_beap_routing: 'direct',
      }),
    )

    const ctx = buildWizardEntryContext(INITIAL_WIZARD_STATE)
    expect(ctx.configurationState).toBe('setup_in_progress')
    expect(ctx.primaryHost).toBe('203.0.113.10')

    const resumed = resumeWizardSetup(INITIAL_WIZARD_STATE)
    expect(resumed.step).toBe('verify_and_switch')
    expect(resumed.replicaIndex).toBe(0)

    _setSettingsPathForTest(null)
    rmSync(tempDir, { recursive: true, force: true })
  })
})

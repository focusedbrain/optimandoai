/**
 * CI-enforced invariant: untrusted BEAP bytes only via pod path (SECURITY/ISOLATION.md).
 */

import { describe, test, expect, vi } from 'vitest'
import { execSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  SecurityInvariantError,
  assertTrustedInternalSourceOnly,
  assertExternalUntrustedViaPodOnly,
  ALLOWED_INGESTION_MODES,
} from '../../security/securityInvariant.js'
import { processIncomingInputInProcess } from '../processIncomingInputInProcess.js'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../../../../')

function runGateScript(extraEnv?: Record<string, string>): { status: number; stderr: string } {
  try {
    execSync('node scripts/check-beap-pod-isolation-gate.mjs', {
      cwd: REPO_ROOT,
      stdio: 'pipe',
      encoding: 'utf8',
      env: { ...process.env, ...extraEnv },
    })
    return { status: 0, stderr: '' }
  } catch (err: unknown) {
    const e = err as { status?: number; stderr?: string }
    return { status: e.status ?? 1, stderr: String(e.stderr ?? '') }
  }
}

describe('BEAP pod isolation — CI static gate', () => {
  test('check-beap-pod-isolation-gate.mjs passes on current tree', () => {
    const { status, stderr } = runGateScript()
    expect(status, stderr).toBe(0)
  })

  test('gate FAILS when LegacyInProcess is simulated (BEAP_GATE_INJECT_LEGACY=1)', () => {
    const { status, stderr } = runGateScript({ BEAP_GATE_INJECT_LEGACY: '1' })
    expect(status).not.toBe(0)
    expect(stderr).toContain('LegacyInProcess')
  })

  test('gate FAILS when production beapEmailIngestion re-adds main-process pBEAP decode', () => {
    const { status, stderr } = runGateScript({ BEAP_GATE_INJECT_PBEAP_DECODE: '1' })
    expect(status).not.toBe(0)
    expect(stderr).toMatch(/pBEAP|beapPackageToMainProcessDepackaged|base64/)
  })
})

describe('BEAP pod isolation — runtime SecurityInvariantError', () => {
  test('assertTrustedInternalSourceOnly rejects external source types', () => {
    expect(() => assertTrustedInternalSourceOnly('email')).toThrow(SecurityInvariantError)
    expect(() => assertTrustedInternalSourceOnly('p2p')).toThrow(SecurityInvariantError)
    expect(() => assertTrustedInternalSourceOnly('coordination_ws')).toThrow(SecurityInvariantError)
  })

  test('assertExternalUntrustedViaPodOnly rejects LegacyInProcess', () => {
    expect(() => assertExternalUntrustedViaPodOnly('LegacyInProcess')).toThrow(SecurityInvariantError)
  })

  test('allowed modes are exactly EdgeActive | HostPodActive | Blocked', () => {
    expect(ALLOWED_INGESTION_MODES).toEqual(['EdgeActive', 'HostPodActive', 'Blocked'])
    for (const m of ALLOWED_INGESTION_MODES) {
      expect(() => assertExternalUntrustedViaPodOnly(m)).not.toThrow()
    }
  })

  test('processIncomingInputInProcess throws for non-internal sourceType', async () => {
    await expect(
      processIncomingInputInProcess(
        { body: '{}', mime_type: 'application/json' },
        'email',
        { channel_id: 'test' },
      ),
    ).rejects.toThrow(SecurityInvariantError)
  })

  test('dispatchProcessIncomingInput throws on forbidden ingestion mode', async () => {
    vi.resetModules()
    vi.doMock('../ingestionModeService.js', () => ({
      getCurrentIngestionMode: vi.fn(async () => ({
        mode: 'LegacyInProcess',
        blockedReason: null,
        hostPodVariant: null,
        waitForHostPod: false,
        settings: {},
        probes: {},
      })),
      refreshIngestionMode: vi.fn(),
    }))
    const { dispatchProcessIncomingInput: dispatch } = await import('../ingestionDispatcher.js')
    await expect(
      dispatch(
        { body: '{}', mime_type: 'application/json' },
        'email',
        { channel_id: 'test' },
      ),
    ).rejects.toMatchObject({
      name: 'SecurityInvariantError',
      code: 'SECURITY_INVARIANT_VIOLATION',
      message: expect.stringContaining('LegacyInProcess'),
    })
    vi.doUnmock('../ingestionModeService.js')
  })
})

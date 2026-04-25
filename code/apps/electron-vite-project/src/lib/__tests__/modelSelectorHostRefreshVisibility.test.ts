/**
 * STEP 10 — ↻ (refresh) visibility + orchestrator/ledger agreement (regression).
 */
import { describe, it, expect } from 'vitest'
import {
  computeShowHostInferenceRefresh,
  handshakeLocalRoleForModelSelectorLog,
} from '../modelSelectorHostRefreshVisibility'
import { getOrchestratorModeVsHandshakeInfo } from '../orchestratorModeVsHandshake'
import { hostInferenceOptionVisible, hostInferenceSetupMessageVisible } from '../hostInferenceUiGates'

describe('STEP 10 — model selector: Host AI refresh visibility', () => {
  it('(1) configured host + ledger proves Sandbox side (internal pair): show refresh (ledger drives)', () => {
    const r = computeShowHostInferenceRefresh({
      orchModeReady: true,
      orchIsSandbox: false,
      orchIsHost: true,
      ledgerProvesInternalSandboxToHost: true,
      ledgerProvesLocalHostPeerSandbox: false,
      discoveryHasHostInternalRows: false,
    })
    expect(r).toEqual({ show: true, reason: 'ledger_sandbox_to_host' })
  })

  it('(2) configured sandbox + ledger says this device is Host on internal pair: refresh hidden', () => {
    const r = computeShowHostInferenceRefresh({
      orchModeReady: true,
      orchIsSandbox: true,
      orchIsHost: false,
      ledgerProvesInternalSandboxToHost: false,
      ledgerProvesLocalHostPeerSandbox: true,
      discoveryHasHostInternalRows: false,
    })
    expect(r).toEqual({ show: false, reason: 'ledger_local_host_device_on_internal_pair' })
  })

  it('(2) local-host ledger suppresses ↻ even if discovery also reported host rows', () => {
    const r = computeShowHostInferenceRefresh({
      orchModeReady: true,
      orchIsSandbox: true,
      orchIsHost: false,
      ledgerProvesInternalSandboxToHost: false,
      ledgerProvesLocalHostPeerSandbox: true,
      discoveryHasHostInternalRows: true,
    })
    expect(r.show).toBe(false)
  })
})

describe('STEP 10 — configured mode vs active internal handshake (renderer logs)', () => {
  it('(1) mismatch: file says host, ledger says Sandbox (client) on pair', () => {
    const i = getOrchestratorModeVsHandshakeInfo({
      orchModeReady: true,
      mode: 'host',
      ledgerProvesInternalSandboxToHost: true,
      ledgerProvesLocalHostPeerSandbox: false,
    })
    expect(i).toMatchObject({ mismatch: true, kind: 'config_host_ledger_sandbox' })
  })

  it('(2) mismatch: file says sandbox, ledger says this device is Host on pair', () => {
    const i = getOrchestratorModeVsHandshakeInfo({
      orchModeReady: true,
      mode: 'sandbox',
      ledgerProvesInternalSandboxToHost: false,
      ledgerProvesLocalHostPeerSandbox: true,
    })
    expect(i).toMatchObject({ mismatch: true, kind: 'config_sandbox_ledger_host' })
  })

  it('no mismatch when there is no active internal role signal', () => {
    expect(
      getOrchestratorModeVsHandshakeInfo({
        orchModeReady: true,
        mode: 'host',
        ledgerProvesInternalSandboxToHost: false,
        ledgerProvesLocalHostPeerSandbox: false,
      }),
    ).toEqual({ mismatch: false })
  })

  it('(4) configured Sandbox, no internal handshake: setup hint can show (gated elsewhere by loading)', () => {
    expect(hostInferenceSetupMessageVisible(true, 'sandbox', false, 0)).toBe(true)
  })

  it('(9) direct Host candidate count (not local Ollama) gates Host AI option: one Host row ⇒ visible in Sandbox', () => {
    expect(hostInferenceOptionVisible(true, 'sandbox', 1)).toBe(true)
  })

  it('handshakeLocalRoleForModelSelectorLog matches flags', () => {
    expect(
      handshakeLocalRoleForModelSelectorLog({
        ledgerProvesInternalSandboxToHost: true,
        ledgerProvesLocalHostPeerSandbox: false,
      }),
    ).toBe('sandbox')
    expect(
      handshakeLocalRoleForModelSelectorLog({
        ledgerProvesInternalSandboxToHost: false,
        ledgerProvesLocalHostPeerSandbox: true,
      }),
    ).toBe('host')
  })
})

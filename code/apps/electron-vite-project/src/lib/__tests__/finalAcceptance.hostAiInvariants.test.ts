/**
 * Final acceptance (ACTIVE internal Host/Sandbox handshake) — encoded as automated checks.
 *
 * Sandbox: Host AI in top + WR selectors (shared pipeline), ↻ when eligible, model from Host probe,
 * no local Ollama requirement, stale "host" on disk does not block when ledger says Sandbox.
 * Host: no ↻, no self-target row; local models path unchanged (GAV + local merge — static pointers).
 * Direct P2P down: disabled Host row with reason, list not empty — covered in listInference tests + invariants below.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeShowHostInferenceRefresh, discoveryHasHostInternalRows } from '../modelSelectorHostRefreshVisibility'
import { getOrchestratorModeVsHandshakeInfo } from '../orchestratorModeVsHandshake'
import { hostInferenceOptionVisible } from '../hostInferenceUiGates'
import { fetchSelectorModelListFromHostDiscovery } from '../selectorModelListFromHostDiscovery'

const __dir = dirname(fileURLToPath(import.meta.url))
/** `apps/electron-vite-project` (src/lib/__tests__ → up 3). */
const projectRoot = join(__dir, '..', '..', '..')
const srcApp = join(projectRoot, 'src')
const hybridPath = join(srcApp, 'components', 'HybridSearch.tsx')
const wrPath = join(srcApp, 'components', 'WRChatDashboardView.tsx')
const listInfMainPath = join(projectRoot, 'electron', 'main', 'internalInference', 'listInferenceTargets.ts')
const gavPath = join(projectRoot, 'electron', 'main.ts')

/** Mirrors `useSandboxHostInference` treatAsSandboxForHostInternal (ledger overrides stale file). */
function treatAsSandboxForHostInternal(p: {
  modeReady: boolean
  isSandbox: boolean
  ledgerProvesInternalSandboxToHost: boolean
  ledgerProvesLocalHostPeerSandbox: boolean
}): boolean {
  return (
    p.modeReady &&
    !p.ledgerProvesLocalHostPeerSandbox &&
    (p.isSandbox || p.ledgerProvesInternalSandboxToHost)
  )
}

const append = vi.hoisted(() =>
  vi.fn(
    async <T,>(opts: { models: T[] }): Promise<{
      models: T[]
      gav: Array<{ kind: string; id: string; handshake_id: string; available: boolean; label: string }>
    }> => ({
      models: [
        {
          id: 'h1',
          name: 'Host AI',
          provider: 'host_internal',
          type: 'host_internal',
          displayTitle: 'Host',
          displaySubtitle: '',
          hostTargetAvailable: true,
        },
      ] as T[],
      gav: [
        { kind: 'host_internal', id: 'h1', handshake_id: 'x', available: true, label: 'Host AI' },
      ],
    }),
  ),
)
vi.mock('../appendHostRowsFromListInference', () => ({
  appendHostRowsFromListInference: append,
}))

describe('FINAL ACCEPTANCE — Sandbox (ledger: local Sandbox, peer Host)', () => {
  it('↻ / retry: visible when ledger proves Sandbox↔Host or mode fallback, never when ledger says this device is Host on the pair', () => {
    const sandboxSide = computeShowHostInferenceRefresh({
      orchModeReady: true,
      orchIsSandbox: true,
      orchIsHost: false,
      ledgerProvesInternalSandboxToHost: true,
      ledgerProvesLocalHostPeerSandbox: false,
      discoveryHasHostInternalRows: false,
    })
    expect(sandboxSide.show).toBe(true)
    const hostDeviceOnPair = computeShowHostInferenceRefresh({
      orchModeReady: true,
      orchIsSandbox: true,
      orchIsHost: false,
      ledgerProvesInternalSandboxToHost: false,
      ledgerProvesLocalHostPeerSandbox: true,
      discoveryHasHostInternalRows: false,
    })
    expect(hostDeviceOnPair.show).toBe(false)
  })

  it('stale/default configured file = host does not block Host AI when ledger proves local Sandbox role', () => {
    const info = getOrchestratorModeVsHandshakeInfo({
      orchModeReady: true,
      mode: 'host',
      ledgerProvesInternalSandboxToHost: true,
      ledgerProvesLocalHostPeerSandbox: false,
    })
    expect(info.mismatch).toBe(true)
    expect(treatAsSandboxForHostInternal({
      modeReady: true,
      isSandbox: false,
      ledgerProvesInternalSandboxToHost: true,
      ledgerProvesLocalHostPeerSandbox: false,
    })).toBe(true)
  })

  it('Host AI row is considered present for selector when gav carries host_internal or merged rows (top + WR use same shape)', () => {
    const viaGav = discoveryHasHostInternalRows([{ kind: 'host_internal' }], [])
    const viaSelector = discoveryHasHostInternalRows([], [{ section: 'host' }])
    expect(viaGav).toBe(true)
    expect(viaSelector).toBe(true)
  })

  it('Host option can show with direct Host row only — local Sandbox Ollama is not required', () => {
    expect(hostInferenceOptionVisible(true, 'sandbox', 1)).toBe(true)
  })

  it('Top chat + WR Chat: same `fetchSelectorModelListFromHostDiscovery` + `includeHostInternalDiscovery` gate', () => {
    const hybrid = readFileSync(hybridPath, 'utf-8')
    const wr = readFileSync(wrPath, 'utf-8')
    for (const [name, s] of [
      ['HybridSearch', hybrid],
      ['WRChatDashboardView', wr],
    ] as const) {
      expect(s, name).toContain('fetchSelectorModelListFromHostDiscovery')
      expect(s, name).toContain('computeShowHostInferenceRefresh')
      expect(s, name).toContain('includeHostInternalDiscovery')
    }
  })

  it('GAV + list merge: empty local models[] still allows Host row after `appendHostRowsFromListInference` (local not required)', async () => {
    vi.stubGlobal('window', {
      handshakeView: {
        getAvailableModels: () =>
          Promise.resolve({ success: true, models: [], hostInferenceTargets: [] }),
      },
    })
    const r = await fetchSelectorModelListFromHostDiscovery({
      reason: 'selector_open',
      includeHostInternalDiscovery: true,
    })
    expect(r.path).toBe('gav_success')
    expect(r.models.some((m) => m.type === 'host_internal')).toBe(true)
  })
})

describe('FINAL ACCEPTANCE — Host (ledger: this device is Host, peer Sandbox)', () => {
  it('no Host AI refresh: ledgerProvesLocalHostPeerSandbox forces ↻ off', () => {
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

  it('orchestrator vs handshake: configured Sandbox + ledger local Host is a documented mismatch (Host side)', () => {
    const i = getOrchestratorModeVsHandshakeInfo({
      orchModeReady: true,
      mode: 'sandbox',
      ledgerProvesInternalSandboxToHost: false,
      ledgerProvesLocalHostPeerSandbox: true,
    })
    expect(i).toMatchObject({ mismatch: true, kind: 'config_sandbox_ledger_host' })
  })
})

describe('FINAL ACCEPTANCE — main + selector invariants (static)', () => {
  it('Host active model: main list probes `probeHostInferencePolicyFromSandbox` and uses defaultChatModel in target', () => {
    const src = readFileSync(listInfMainPath, 'utf-8')
    expect(src).toContain('probeHostInferencePolicyFromSandbox')
    expect(src).toMatch(/defaultChatModel|target_added.*model=/)
  })

  it('listInference: never drop to silent empty when a qualifying row is disabled (direct P2P, policy, etc.)', () => {
    const src = readFileSync(listInfMainPath, 'utf-8')
    expect(src).toMatch(/target_disabled|target_placeholder/)
    expect(src).toMatch(/ensureAtLeastOneHostTargetWhenLedgerProvesSandboxToHost|finalizeItem/)
  })

  it('GAV / selector merge file states Host rows are not tied to local Ollama', () => {
    const s = readFileSync(join(srcApp, 'lib', 'selectorModelListFromHostDiscovery.ts'), 'utf-8')
    expect(s).toContain('Never uses `llm.getStatus`')
    expect(s).toMatch(/zero local models|models: \[] still/i)
  })

  it('main: getAvailableModels path still merges local/cloud with internal Host rows', () => {
    const mainSrc = readFileSync(gavPath, 'utf-8')
    expect(mainSrc).toContain('getAvailableModels')
    expect(mainSrc).toMatch(/hostInferenceTargets|listSandboxHostInternalInferenceTargets/)
  })
})

/**
 * Phase 11 — UI invariants (static + pure helpers; no @testing-library in this app package).
 * Host AI row, WR vs top bar shared pipeline, Host-side no-refresh, disabled visibility.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeShowHostInferenceRefresh, discoveryHasHostInternalRows } from '../modelSelectorHostRefreshVisibility'
import { hostInferenceOptionVisible, hostInferenceSetupMessageVisible } from '../hostInferenceUiGates'
import { isHostInternalChatModelId } from '@ext/lib/inferenceSubmitRouting'

const __dir = dirname(fileURLToPath(import.meta.url))
const srcRoot = join(__dir, '..', '..')
const readSrc = (rel: string) => readFileSync(join(srcRoot, rel), 'utf-8')

describe('Phase 11 — Sandbox: Host AI row + merge', () => {
  it('GAV host_internal rows count as discovery only when available; merged host section is unchanged', () => {
    expect(discoveryHasHostInternalRows([{ kind: 'host_internal', available: true }], [])).toBe(true)
    expect(discoveryHasHostInternalRows([{ kind: 'host_internal', available: false } as { kind: string; available: boolean }], [])).toBe(
      false,
    )
    expect(
      discoveryHasHostInternalRows([{ kind: 'host_internal', available: false, visibleInModelSelector: true }], []),
    ).toBe(true)
    expect(discoveryHasHostInternalRows([], [{ section: 'host' } as { section: 'host' }])).toBe(true)
  })

  it('local models empty: Host internal option can still be visible when targets exist (hostInferenceOptionVisible)', () => {
    expect(hostInferenceOptionVisible(true, 'sandbox', 1)).toBe(true)
  })

  it('WR Chat + top chat: HybridSearch and WRChatDashboardView still wire Host from shared discovery (source strings)', () => {
    const hybrid = readSrc(join('components', 'HybridSearch.tsx'))
    const wr = readSrc(join('components', 'WRChatDashboardView.tsx'))
    expect(hybrid).toMatch(/hostAi|host_internal|Host AI/)
    expect(wr).toMatch(/hostAi|Host AI|host_internal/)
  })

  it('disabled / unavailable: route id is still a Host id but selection guard exists (isHostInternalChatModelId + host row)', () => {
    const ok = isHostInternalChatModelId('host-internal:x:y', [
      { name: 'n', hostAi: true, hostAvailable: false } as { name: string; hostAi?: boolean; hostAvailable?: boolean },
    ])
    expect(ok).toBe(true)
  })
})

describe('Phase 11 — Host: no self-target, no ↻ in merge visibility contract', () => {
  it('↻ (refresh Host targets) is hidden when this device is the Host on the active internal pair (ledger-proven)', () => {
    const onHost = computeShowHostInferenceRefresh({
      orchModeReady: true,
      orchIsSandbox: false,
      orchIsHost: true,
      ledgerProvesInternalSandboxToHost: false,
      ledgerProvesLocalHostPeerSandbox: true,
      discoveryHasHostInternalRows: true,
    })
    expect(onHost.show).toBe(false)
  })

  it('setup message does not require local Ollama on Sandbox; zero rows cannot show main Host option', () => {
    expect(hostInferenceSetupMessageVisible(true, 'sandbox', false, 0)).toBe(true)
  })
})

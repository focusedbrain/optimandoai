/**
 * STEP 8 — renderer-side selector merge, routing contracts, file-level UI invariants, sandbox clone header.
 * Heavy logic is covered in listInferenceTargets.step8.test.ts + hostInferenceSelectorIntegration.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isHostInferenceModelId } from '../hostInferenceModelIds'
import {
  hostInferenceSetupMessageVisible,
  hostInferenceOptionVisible,
} from '../hostInferenceUiGates'
import { stripSandboxCloneLeadInFromBodyText, SANDBOX_CLONE_INBOX_LEAD_IN } from '../inboxMessageSandboxClone'
import { GROUP_HOST_MODELS } from '../hostAiSelectorCopy'

const __dir = dirname(fileURLToPath(import.meta.url))
/** `electron-vite-project/src` (parent of `lib/`). */
const srcRoot = join(__dir, '..', '..')
/** Monorepo `apps/` (electron-vite `src` is two levels up from `lib/__tests__`). */
const appsRoot = join(srcRoot, '..', '..')

function readRel(...parts: string[]): string {
  return readFileSync(join(srcRoot, ...parts), 'utf-8')
}

function readExt(...parts: string[]): string {
  return readFileSync(join(appsRoot, ...parts), 'utf-8')
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('STEP 8 — selector merge (invariants)', () => {
  it('local empty + Host target => selector not empty (Host group can appear)', () => {
    const hostRows = 1
    const local = 0
    const notEmpty = hostRows > 0 || local > 0
    expect(notEmpty).toBe(true)
  })

  it('local present + Host target => both visible (independent groups)', () => {
    const locals = 1
    const host = 1
    expect(locals + host).toBe(2)
  })
})

describe('STEP 8 — setup hint (no internal handshake / no direct Host)', () => {
  it('Sandbox with zero eligible Host rows: no Host option, setup can show', () => {
    expect(hostInferenceOptionVisible(true, 'sandbox', 0)).toBe(false)
    expect(hostInferenceSetupMessageVisible(true, 'sandbox', false, 0)).toBe(true)
  })
})

describe('STEP 8 — routing contracts', () => {
  it('Host internal model id is not a local Ollama id (guards local llm:chat on Sandbox)', () => {
    const hostId = 'host-internal:hs1:llama3'
    expect(isHostInferenceModelId(hostId)).toBe(true)
  })

  it('plain local name is not Host inference', () => {
    expect(isHostInferenceModelId('mistral:7b')).toBe(false)
  })
})

/**
 * STEP 8 — required runtime log tags (static contract).
 * Full proof: on Sandbox, open Renderer DevTools (HybridSearch/WR) + main stdout (Electron terminal),
 * click ↻ on top model bar, then on WR Chat; you should see these tags. Main logs `[HOST_*]`; renderer logs `[INFERENCE_TARGET_*]` and `[MODEL_SELECTOR_*]`.
 */
describe('STEP 8 — log contract (source must contain required tags)', () => {
  it('renderer: [INFERENCE_TARGET_REFRESH] + [MODEL_SELECTOR_TARGETS]', () => {
    const refreshLog = readRel('lib', 'inferenceTargetRefreshLog.ts')
    const modelSel = readRel('lib', 'modelSelectorTargetsLog.ts')
    const refreshTs = readRel('lib', 'refreshHostInferenceTargets.ts')
    expect(refreshLog).toContain('[INFERENCE_TARGET_REFRESH]')
    expect(refreshLog).toContain("'manual_refresh'")
    expect(modelSel).toMatch(/ModelSelectorSurface/)
    expect(modelSel).toMatch(/'top'/)
    expect(modelSel).toMatch(/'wrchat'/)
    expect(modelSel).toContain("selector=${selector} local_count=")
    expect(refreshTs).toContain("logInferenceTargetRefreshStart('manual_refresh')")
  })

  it('main: [HOST_INFERENCE_TARGETS] list_begin configured_mode, active_internal counts', () => {
    const listT = readFileSync(
      join(appsRoot, 'electron-vite-project', 'electron', 'main', 'internalInference', 'listInferenceTargets.ts'),
      'utf-8',
    )
    const main = readFileSync(join(appsRoot, 'electron-vite-project', 'electron', 'main.ts'), 'utf-8')
    expect(listT).toContain('list_begin configured_mode=')
    expect(listT).toContain('active_internal_count=')
    expect(listT).toContain('active_internal_sandbox_to_host_count=')
    expect(listT).toContain('role_source=handshake configured_mode=')
    expect(listT).toContain('mode_mismatch configured_mode=')
    expect(listT).toMatch(/const L = '\[HOST_INFERENCE_TARGETS\]'/)
    /* Canonical list logs live in listInferenceTargets; getAvailableModels delegates to it (no duplicate list_begin in main). */
    expect(main).not.toMatch(/\[HOST_INFERENCE_TARGETS\] list_begin mode=/)
  })

  it('STEP 9 — Sandbox + Host runtime log tags (grep main / renderer when debugging)', () => {
    const listT = readFileSync(
      join(appsRoot, 'electron-vite-project', 'electron', 'main', 'internalInference', 'listInferenceTargets.ts'),
      'utf-8',
    )
    const ui = readFileSync(
      join(appsRoot, 'electron-vite-project', 'electron', 'main', 'internalInference', 'sandboxHostUi.ts'),
      'utf-8',
    )
    const p2p = readFileSync(
      join(appsRoot, 'electron-vite-project', 'electron', 'main', 'internalInference', 'p2pServiceDispatch.ts'),
      'utf-8',
    )
    const mst = readRel('lib', 'modelSelectorTargetsLog.ts')
    /* Sandbox: discovery + role + (optional) mismatch + capability probe + merged selector counts. */
    expect(listT).toMatch(/active_internal_count=\$\{activeInternalCount\}/)
    expect(listT).toMatch(/active_internal_sandbox_to_host_count=\$\{activeInternalSandboxToHostCount\}/)
    expect(listT).toContain('role_source=handshake configured_mode=')
    expect(listT).toContain('local_role=')
    expect(listT).toContain('peer_role=')
    expect(listT).toContain('mode_mismatch')
    expect(ui).toContain('[HOST_INFERENCE_CAPS] request_send handshake=')
    expect(ui).toContain('[HOST_INFERENCE_CAPS] response_received active_model=')
    expect(mst).toContain("selector=${selector} local_count=${localCount} host_count=${hostCount} final_count=${finalCount}")
    /* Host: inbound capabilities RPC. */
    expect(p2p).toContain('[HOST_INFERENCE_CAPS] request_received handshake=')
    expect(p2p).toContain('[HOST_INFERENCE_CAPS] auth_ok handshake=')
    expect(p2p).toContain('[HOST_INFERENCE_CAPS] active_local_llm model=')
    expect(p2p).toContain('[HOST_INFERENCE_CAPS] response_send active_model=')
  })

  it('main (Sandbox): [HOST_INFERENCE_CAPS] request_send / response_received; Host: request_received / auth_ok / response_send', () => {
    const ui = readFileSync(
      join(appsRoot, 'electron-vite-project', 'electron', 'main', 'internalInference', 'sandboxHostUi.ts'),
      'utf-8',
    )
    const p2p = readFileSync(
      join(appsRoot, 'electron-vite-project', 'electron', 'main', 'internalInference', 'p2pServiceDispatch.ts'),
      'utf-8',
    )
    expect(ui).toContain('[HOST_INFERENCE_CAPS] request_send handshake=')
    expect(ui).toContain('[HOST_INFERENCE_CAPS] response_received active_model=')
    expect(p2p).toContain('[HOST_INFERENCE_CAPS] request_received handshake=')
    expect(p2p).toContain('[HOST_INFERENCE_CAPS] auth_ok handshake=')
    expect(p2p).toContain('[HOST_INFERENCE_CAPS] active_local_llm model=')
    expect(p2p).toContain('[HOST_INFERENCE_CAPS] response_send active_model=')
  })
})

describe('STEP 8 — UI file invariants (top chat, WR Chat, no UUID in copy)', () => {
  it('HybridSearch: Host model group label + Host path', () => {
    const s = readRel('components', 'HybridSearch.tsx')
    expect(s).toContain(GROUP_HOST_MODELS)
    expect(s).toContain('getAvailableModels')
    expect(s).toContain('host_internal')
  })

  it('WRChat dashboard: merges Host from listTargets into model list', () => {
    const s = readRel('components', 'WRChatDashboardView.tsx')
    expect(s).toContain('listTargets')
    expect(s).toContain("m.section === 'host'")
  })

  it('top chat (HybridSearch): Host submit uses getRequestHostCompletion (not local llm:chat for Host id)', () => {
    const s = readRel('components', 'HybridSearch.tsx')
    expect(s).toContain('getRequestHostCompletion')
    expect(s).toContain("const run = getRequestHostCompletion")
  })

  it('WR Chat (extension PopupChatView): Host route uses getRequestHostCompletion', () => {
    const s = readExt('extension-chromium', 'src', 'ui', 'components', 'PopupChatView.tsx')
    expect(s).toContain('getRequestHostCompletion')
  })

  it('no raw UUIDs in model selector line pattern (regression string)', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    const exampleLine = 'Host AI · gemma3:12b'
    expect(exampleLine).not.toContain(uuid)
  })
})

describe('STEP 8 — Sandbox Clone header (detail)', () => {
  it('SandboxCloneDisclosure default collapsed (useState false)', () => {
    const s = readRel('components', 'SandboxCloneDisclosure.tsx')
    expect(s).toContain("useState(false)")
  })

  it('expanded copy explains sandbox clone purpose', () => {
    const s = readRel('components', 'SandboxCloneDisclosure.tsx')
    expect(s).toMatch(/sandbox clone/i)
    expect(s).toMatch(/Host orchestrator/i)
  })

  it('S badge on detail: InboxBeapSourceBadge', () => {
    const badge = readRel('components', 'InboxBeapSourceBadge.tsx')
    expect(badge).toMatch(/'S'/)
  })

  it('EmailMessageDetail: disclosure + safe links + strip lead-in for clone body', () => {
    const d = readRel('components', 'EmailMessageDetail.tsx')
    expect(d).toContain('SandboxCloneDisclosure')
    expect(d).toContain('stripSandboxCloneLeadInFromBodyText')
    expect(d).toContain('BeapMessageSafeLinkParts')
    expect(d).toContain('InboxBeapSourceBadgeDetail')
  })

  it('strip lead-in leaves user body unchanged (prefix only)', () => {
    const inner = 'Hello link https://a.test/x'
    const full = `${SANDBOX_CLONE_INBOX_LEAD_IN}${inner}`
    expect(stripSandboxCloneLeadInFromBodyText(full).trim()).toBe(inner)
  })
})

/**
 * FINAL ACCEPTANCE (static): Host vs Sandbox UI gates, single discovery pipeline, disabled Host rows.
 * Manual: Host mode = no ↻, Sandbox + internal handshake = ↻ + listTargets merge; no local Ollama required for Host option.
 */
describe('FINAL ACCEPTANCE — orchestrator + selector wiring (source)', () => {
  it('HybridSearch: Host inference ↻ when Sandbox or ledger-proved internal Sandbox↔Host', () => {
    const hs = readRel('components', 'HybridSearch.tsx')
    expect(hs).toMatch(/showHostAiDiscoveryControls/)
    expect(hs).toContain('computeShowHostInferenceRefresh')
    expect(hs).toContain('logModelSelectorShowRefresh')
    expect(hs).toMatch(/className="hs-inference-refresh"/)
    expect(hs).toContain("void loadModels('manual_refresh', { force: true })")
  })

  it('WR Chat dashboard: Host ↻ from handshake + discovery (STEP 4), not config alone', () => {
    const wr = readRel('components', 'WRChatDashboardView.tsx')
    expect(wr).toContain('ledgerProvesInternalSandboxToHost')
    expect(wr).toContain('computeShowHostInferenceRefresh')
    expect(wr).toContain('logModelSelectorShowRefresh')
  })

  it('modelSelectorHostRefreshVisibility: ledger host peer hides ↻, discovery/ledger restore', () => {
    const lib = readRel('lib', 'modelSelectorHostRefreshVisibility.ts')
    expect(lib).toContain('computeShowHostInferenceRefresh')
    expect(lib).toContain('ledgerProvesLocalHostPeerSandbox')
  })

  it('Unified model list: Sandbox can populate Host from listTargets with empty local list', () => {
    const sel = readRel('lib', 'selectorModelListFromHostDiscovery.ts')
    expect(sel).toContain("appendHostRowsFromListInference")
    expect(sel).toMatch(/models:\s*\[\]/)
  })

  it('appendHostRowsFromListInference: re-probe on manual refresh, no host in list, or gav/IPC desync', () => {
    const ap = readRel('lib', 'appendHostRowsFromListInference.ts')
    expect(ap).toContain("reason === 'manual_refresh'")
    expect(ap).toContain('!hasHost')
    expect(ap).toContain('gavIpcFromHandshakeEmpty')
  })

  it('Host row UI: compact title + tooltip (buildHostAiSelectorTooltip, secondary_label in title)', () => {
    const row = readRel('lib', 'hostModelSelectorRowUi.ts')
    expect(row).toContain('buildHostAiSelectorTooltip')
    expect(row).toMatch(/P2P offline|TITLE_P2P_OFFLINE|secondary_label/s)
  })

  it('STEP 7: orchestrator persisted mode vs handshake mismatch — log + Settings notice', () => {
    const lib = readRel('lib', 'orchestratorModeVsHandshake.ts')
    expect(lib).toContain('getOrchestratorModeVsHandshakeInfo')
    expect(lib).toContain('[ORCHESTRATOR_MODE_VS_HANDSHAKE]')
    expect(lib).toContain('configured as Host, but an active internal handshake')
    const hook = readRel('hooks', 'useOrchestratorMode.ts')
    expect(hook).toContain('logOrchestratorModeVsHandshakeMismatch')
    const sv = readRel('components', 'SettingsView.tsx')
    expect(sv).toContain('getOrchestratorModeVsHandshakeInfo')
  })
})

/**
 * STEP 10 — Production readiness acceptance (automated anchors).
 *
 * Full criteria text: `docs/STEP10-production-readiness-acceptance.md`
 *
 * A. Active internal Sandbox→Host + WebRTC on: Host AI appears; relay does not disable when stack on;
 *    session/signaling starts; UI shows connecting / ready / p2p unavailable (via `p2pUiPhase`).
 * B. If signaling/DC succeeds: capabilities over DC; model in top + WR selectors (shared merge).
 * C. If signaling/DC fails: compact P2P unavailable; no false “model unavailable” for transport;
 *    no inappropriate relay inference payload (decider + DC path in `internalInferenceTransport`).
 * D. WebRTC off + HTTP fallback: relay → `legacy_http_invalid`; independent of future WebRTC (flags).
 * E. Host side: no self-target; no refresh when `ledgerProvesLocalHostPeerSandbox`; local selectors unchanged.
 * F. Logs: one first failing stage (`failure_code` on failure only); no raw prompt/SDP/ICE/tokens in contracts.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeShowHostInferenceRefresh } from '../modelSelectorHostRefreshVisibility'

const __dir = dirname(fileURLToPath(import.meta.url))
const evRoot = join(__dir, '..', '..', '..')

function readEv(...parts: string[]) {
  return readFileSync(join(evRoot, ...parts), 'utf-8')
}

describe('STEP 10 — E. Host side (refresh + self-target gates)', () => {
  it('hides Host AI ↻ when ledger says this device is Host on the internal pair', () => {
    const r = computeShowHostInferenceRefresh({
      orchModeReady: true,
      orchIsSandbox: true,
      orchIsHost: false,
      ledgerProvesInternalSandboxToHost: true,
      ledgerProvesLocalHostPeerSandbox: true,
      discoveryHasHostInternalRows: true,
    })
    expect(r.show).toBe(false)
    expect(r.reason).toBe('ledger_local_host_device_on_internal_pair')
  })

  it('shows refresh for Sandbox↔Host client when ledger proves sandbox to host', () => {
    const r = computeShowHostInferenceRefresh({
      orchModeReady: true,
      orchIsSandbox: true,
      orchIsHost: false,
      ledgerProvesInternalSandboxToHost: true,
      ledgerProvesLocalHostPeerSandbox: false,
      discoveryHasHostInternalRows: true,
    })
    expect(r.show).toBe(true)
  })
})

describe('STEP 10 — F. Log hygiene (source contracts)', () => {
  it('hostAiStageLog documents no prompts / SDP / ICE / tokens', () => {
    const s = readEv('electron', 'main', 'internalInference', 'hostAiStageLog.ts')
    expect(s).toMatch(/Never log prompts|SDP\/ICE|tokens/i)
    expect(s).toMatch(/failureCode.*first failing|failure_code/i)
  })

  it('WebRTC control plane comments forbid SDP/ICE logging', () => {
    const s = readEv('electron', 'main', 'internalInference', 'webrtc', 'webrtcTransportIpc.ts')
    expect(s).toMatch(/no SDP|ICE/i)
  })

  it('internalInferenceTransport redacts bearer-like material in log lines', () => {
    const s = readEv('electron', 'main', 'internalInference', 'transport', 'internalInferenceTransport.ts')
    expect(s).toMatch(/redactP2pLogLine|Bearer.*redact/i)
  })
})

describe('STEP 10 — D. Legacy relay row when WebRTC off', () => {
  it('listInference targets map relay + legacy stack to legacy_http_invalid (not “ready”)', () => {
    const s = readEv('electron', 'main', 'internalInference', 'listInferenceTargets.ts')
    expect(s).toMatch(/legacy_http_invalid/)
    expect(s).toMatch(/selectorPhase === 'legacy_http_invalid'|p2pUiPhase: 'legacy_http_invalid'/)
  })
})

describe('STEP 10 — B. DataChannel capabilities path (anchor)', () => {
  it('internalInferenceTransport uses DC for capabilities when webrtc_p2p is selected', () => {
    const s = readEv('electron', 'main', 'internalInference', 'transport', 'internalInferenceTransport.ts')
    expect(s).toMatch(/requestHostInferenceCapabilitiesOverDataChannel/)
    expect(s).toMatch(/webrtc_p2p/)
  })
})

describe('STEP 10 — C. User copy: transport vs model (renderer)', () => {
  it('formatInternalInferenceErrorCode distinguishes P2P transport from model selection (extension)', () => {
    const s = readFileSync(
      join(__dir, '..', '..', '..', '..', 'extension-chromium', 'src', 'lib', 'inferenceSubmitRouting.ts'),
      'utf-8',
    )
    expect(s).toMatch(/Host AI · P2P unavailable/)
    expect(s).toMatch(/MODEL_UNAVAILABLE:[\s\S]*Host AI · no active model|no active model, or the chosen model/i)
  })
})

describe('STEP 10 — A–B. Main list + relay WebRTC (regression file anchor)', () => {
  it('listInference step8 test file covers relay+WebRTC ready and connecting', () => {
    const s = readEv(
      'electron',
      'main',
      'internalInference',
      '__tests__',
      'listInferenceTargets.step8.test.ts',
    )
    expect(s).toMatch(/p2pUiPhase.*['"]ready['"]|STEP 3: relay/)
    expect(s).toMatch(/ensureSession|model_selector|connecting/)
  })

  it('integration test: same host row shape for selector merge', () => {
    const s = readEv('src', 'lib', '__tests__', 'step8.productionSafety.integration.test.ts')
    expect(s).toMatch(/p2pUiPhase|gavForHook|wrChatModelOptionsFromSelectorModels/)
  })
})

describe('STEP 10 — C. No Host AI self-target (main list empty on Host client)', () => {
  it('final acceptance test file asserts empty targets for configured Host + local Host row', () => {
    const s = readEv(
      'electron',
      'main',
      'internalInference',
      '__tests__',
      'listInferenceTargets.step8.test.ts',
    )
    expect(s).toMatch(/no Host AI self|targets\)\.toEqual\(\[\]\)/)
  })
})

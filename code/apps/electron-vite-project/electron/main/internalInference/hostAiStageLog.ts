/**
 * [HOST_AI_STAGE] — one correlation `chain` per Host AI attempt; build stamp + P2P flags on every line.
 * Never log prompts, completions, document text, URL bodies, SDP/ICE, tokens, or decrypted BEAP content.
 */
import { randomUUID } from 'crypto'
import type { P2pInferenceFlagSnapshot } from './p2pInferenceFlags'

declare const __ORCHESTRATOR_BUILD_STAMP__: string | undefined

const B = 'build'
const C = 'chain'
const F = 'failure_code'
const FG = 'flags'
const H = 'handshake'
const P = 'phase'
const R = 'reached'
const RE = 'request'
const ST = 'stage'
const SU = 'success'
const T = 'p2p_session'

export type HostAiStageLogName =
  | 'handshake_role'
  | 'feature_flags'
  | 'selector_target'
  | 'signaling'
  | 'datachannel'
  | 'capabilities_request'
  | 'capabilities_response'
  | 'model_projection'

export function getHostAiBuildStamp(): string {
  try {
    if (typeof __ORCHESTRATOR_BUILD_STAMP__ !== 'undefined' && String(__ORCHESTRATOR_BUILD_STAMP__).trim()) {
      return String(__ORCHESTRATOR_BUILD_STAMP__).trim()
    }
  } catch {
    /* global may be absent in tests */
  }
  const e = (process.env.WR_ORCHESTRATOR_BUILD_STAMP ?? process.env.VITE_ORCHESTRATOR_BUILD_STAMP ?? '').trim()
  return e || 'unknown'
}

/** Deterministic, compact JSON of P2P inference flags (booleans only; no secrets). */
export function hostAiP2pFlagsForLog(f: P2pInferenceFlagSnapshot): string {
  return JSON.stringify({
    p2pInferenceEnabled: f.p2pInferenceEnabled,
    p2pInferenceWebrtcEnabled: f.p2pInferenceWebrtcEnabled,
    p2pInferenceSignalingEnabled: f.p2pInferenceSignalingEnabled,
    p2pInferenceCapsOverP2p: f.p2pInferenceCapsOverP2p,
    p2pInferenceRequestOverP2p: f.p2pInferenceRequestOverP2p,
    p2pInferenceHttpFallback: f.p2pInferenceHttpFallback,
    p2pInferenceHttpInternalCompat: f.p2pInferenceHttpInternalCompat,
  })
}

type HostAiStageLogArgs = {
  chain: string
  stage: HostAiStageLogName
  reached: boolean
  success: boolean
  handshakeId: string
  buildStamp: string
  flags: P2pInferenceFlagSnapshot
  p2pSessionId?: string | null
  requestId?: string | null
  phase?: string | null
  /** Only when `success` is false — stable classifier for the first failing stage. */
  failureCode?: string | null
}

/**
 * One line per stage transition. Use the same `chain` for a single user-visible attempt
 * (capabilities fetch, list row probe, or completion request) so support can follow one correlation path.
 */
export function logHostAiStage(args: HostAiStageLogArgs): void {
  const parts: string[] = [
    '[HOST_AI_STAGE]',
    `${ST}=${args.stage}`,
    `${R}=${args.reached ? 'true' : 'false'}`,
    `${SU}=${args.success ? 'true' : 'false'}`,
    `${H}=${args.handshakeId.trim()}`,
    `${C}=${args.chain.trim()}`,
    `${B}=${args.buildStamp.trim() || 'unknown'}`,
    `${FG}=${hostAiP2pFlagsForLog(args.flags)}`,
  ]
  if (args.p2pSessionId !== undefined) {
    parts.push(`${T}=${args.p2pSessionId == null || args.p2pSessionId === '' ? 'null' : String(args.p2pSessionId).trim()}`)
  }
  if (args.requestId !== undefined) {
    parts.push(`${RE}=${args.requestId == null || args.requestId === '' ? 'null' : String(args.requestId).trim()}`)
  }
  if (args.phase !== undefined && args.phase !== null) {
    parts.push(`${P}=${String(args.phase)}`)
  }
  if (args.success === false && args.failureCode != null && String(args.failureCode).trim()) {
    parts.push(`${F}=${String(args.failureCode).trim()}`)
  }
  console.log(parts.join(' '))
}

export function newHostAiCorrelationChain(): string {
  return randomUUID()
}

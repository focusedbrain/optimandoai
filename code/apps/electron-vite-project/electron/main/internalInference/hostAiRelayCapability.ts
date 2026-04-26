/**
 * Fetches coordination-service /health to learn whether Host AI P2P signaling is supported.
 * Isolated from capsule / handshake / queue paths.
 */

import { getP2PConfig } from '../p2p/p2pConfig'
import type { P2pInferenceFlagSnapshot } from './p2pInferenceFlags'
import { buildLegacyEndpointInfoForDecider } from './transport/decideInternalInferenceTransport'

export const HOST_AI_P2P_SIGNALING_SCHEMA_SUPPORTED = 1 as const

const CACHE_TTL_MS = 60_000
const cache = new Map<string, { at: number; result: 'supported' | 'missing' }>()

function p2pStackEnabled(f: P2pInferenceFlagSnapshot): boolean {
  return f.p2pInferenceEnabled && f.p2pInferenceWebrtcEnabled && f.p2pInferenceSignalingEnabled
}

/** @internal */
export function resetHostAiRelayCapabilityCacheForTests(): void {
  cache.clear()
}

/** @internal */
let fetchOverride: typeof fetch | null = null

/** @internal */
export function setHostAiRelayCapabilityFetchForTests(fn: typeof fetch | null): void {
  fetchOverride = fn
}

function doFetch(url: string): Promise<Response> {
  return (fetchOverride ?? fetch)(url, { method: 'GET' })
}

/**
 * Returns whether coordination advertises `host_ai_p2p_signaling` with a supported schema_version.
 */
export async function fetchHostAiP2pSignalingFromCoordinationHealth(
  coordinationBaseUrl: string,
): Promise<{ supported: boolean; schemaVersion: number } | null> {
  const origin = coordinationBaseUrl.replace(/\/$/, '')
  const cached = cache.get(origin)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.result === 'supported'
      ? { supported: true, schemaVersion: HOST_AI_P2P_SIGNALING_SCHEMA_SUPPORTED }
      : null
  }
  try {
    const r = await doFetch(`${origin}/health`)
    if (!r.ok) {
      cache.set(origin, { at: Date.now(), result: 'missing' })
      return null
    }
    const j = (await r.json()) as Record<string, unknown>
    const h = j.host_ai_p2p_signaling as Record<string, unknown> | undefined
    if (
      h &&
      h.supported === true &&
      Number(h.schema_version) === HOST_AI_P2P_SIGNALING_SCHEMA_SUPPORTED
    ) {
      cache.set(origin, { at: Date.now(), result: 'supported' })
      return { supported: true, schemaVersion: HOST_AI_P2P_SIGNALING_SCHEMA_SUPPORTED }
    }
    cache.set(origin, { at: Date.now(), result: 'missing' })
    return null
  } catch {
    cache.set(origin, { at: Date.now(), result: 'missing' })
    return null
  }
}

/**
 * For transport policy: relay + full P2P stack requires coordination health capability.
 */
export async function resolveRelayHostAiP2pSignalingForTransportDecider(
  db: unknown,
  featureFlags: P2pInferenceFlagSnapshot,
  p2pEndpoint: string | null | undefined,
): Promise<'supported' | 'missing' | 'na'> {
  const le = buildLegacyEndpointInfoForDecider(db, p2pEndpoint, featureFlags)
  if (le.p2pEndpointKind !== 'relay') return 'na'
  if (!p2pStackEnabled(featureFlags)) return 'na'
  const cfg = getP2PConfig(db as any)
  const url = cfg.coordination_url?.trim()
  if (!url) {
    console.log(
      '[HOST_AI_CAPABILITY] host_ai_p2p_signaling missing, disabling webrtc_p2p for relay endpoint (no coordination_url)',
    )
    return 'missing'
  }
  const cap = await fetchHostAiP2pSignalingFromCoordinationHealth(url)
  if (cap?.supported) {
    console.log(
      `[HOST_AI_CAPABILITY] host_ai_p2p_signaling supported=true schema_version=${cap.schemaVersion}`,
    )
    return 'supported'
  }
  console.log(
    '[HOST_AI_CAPABILITY] host_ai_p2p_signaling missing, disabling webrtc_p2p for relay endpoint',
  )
  return 'missing'
}

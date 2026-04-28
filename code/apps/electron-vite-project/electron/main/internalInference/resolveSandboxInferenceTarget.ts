/**
 * Sandbox-only: resolves where generic inference should execute — local sandbox Ollama first,
 * then LAN `ollama_direct` caps candidate. Not wired into IPC/render surfaces yet (Prompt 3+).
 */

import { listHandshakeRecords } from '../handshake/db'
import { HandshakeState, type HandshakeRecord } from '../handshake/types'
import { getInstanceId } from '../orchestrator/orchestratorModeStore'
import { getHandshakeDbForInternalInference } from './dbAccess'
import { handshakeSamePrincipal, deriveInternalHostAiPeerRoles } from './policy'
import { getSandboxOllamaDirectRouteCandidate } from './sandboxHostAiOllamaDirectCandidate'

const LOCAL_TAGS_URL = 'http://127.0.0.1:11434/api/tags'
/** Literal base for local sandbox Ollama (tags + chat callers use sibling paths). */
const LOCAL_SANDBOX_BASE_URL = 'http://127.0.0.1:11434' as const

let localProbeCache: { okAt: number; ok: boolean } | null = null
const LOCAL_PROBE_TTL_MS = 10_000
const LOCAL_PROBE_TIMEOUT_MS = 1500

/**
 * Canonical routing result for Sandbox orchestrator inference.
 *
 * **`execution_transport`:** `'ollama_direct'` matches HybridSearch/internalInference IPC (`parseExecutionTransport`).
 * `'local_ollama'` is resolver-only until Prompt 3 wiring — do not pass through `parseExecutionTransport`/`runSandboxHostInferenceChat`;
 * callers should branch on `kind` (`local_sandbox`) for direct local HTTP or existing `chatWithContextRag` paths.
 *
 * **`getSandboxOllamaDirectRouteCandidate`** does **not** expose `accepted`; a defined candidate implies caps validation
 * succeeded when stored (maps only accepted routes per `sandboxHostAiOllamaDirectCandidate`).
 */
export type SandboxInferenceTarget =
  | {
      kind: 'local_sandbox'
      baseUrl: typeof LOCAL_SANDBOX_BASE_URL
      /** Resolver discriminator — **not yet** a `parseExecutionTransport` value */
      execution_transport: 'local_ollama'
    }
  | {
      kind: 'cross_device'
      baseUrl: string
      execution_transport: 'ollama_direct'
      handshakeId: string
      endpointOwnerDeviceId: string
    }
  | {
      kind: 'unavailable'
      reason:
        | 'no_local_ollama_no_cross_device_host'
        | 'cross_device_caps_not_accepted'
        | 'local_probe_error'
      detail?: string
    }

export function invalidateLocalSandboxOllamaProbeCache(): void {
  localProbeCache = null
}

async function probeLocalSandboxOllama(): Promise<boolean> {
  const now = Date.now()
  if (localProbeCache && now - localProbeCache.okAt < LOCAL_PROBE_TTL_MS) {
    return localProbeCache.ok
  }
  try {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), LOCAL_PROBE_TIMEOUT_MS)
    const res = await fetch(LOCAL_TAGS_URL, { signal: ac.signal })
    clearTimeout(timer)
    const ok = res.ok
    localProbeCache = { okAt: now, ok }
    return ok
  } catch (e) {
    localProbeCache = { okAt: now, ok: false }
    return false
  }
}

/** Same semantics as {@link listInferenceTargets}'s row gate — local Sandbox, peer Host, same principal. */
function rowProvesLocalSandboxToHostForHostAi(r: HandshakeRecord): boolean {
  if (!handshakeSamePrincipal(r)) return false
  const dr = deriveInternalHostAiPeerRoles(r, getInstanceId().trim())
  return dr.ok && dr.localRole === 'sandbox' && dr.peerRole === 'host'
}

/**
 * Active internal Sandbox→Host handshakes — **first** ACTIVE row that passes Host-AI sandbox role gate,
 * deterministic `listHandshakeRecords` order. Multiple rows: deterministic but not “preferred” beyond first;
 * call sites with a known handshake should **pass {@link ResolveSandboxInferenceTargetOptions.handshakeId}**.
 *
 * Gap: callers without handshake awareness (e.g. inbox) need either this heuristic or Prompt 4 UX selection.
 */
export async function resolveActiveSandboxToHostHandshakeId(): Promise<string | undefined> {
  const db = await getHandshakeDbForInternalInference()
  if (!db) return undefined
  const ledgerActive = listHandshakeRecords(db, { state: HandshakeState.ACTIVE })
  for (const r of ledgerActive) {
    if (r.handshake_type !== 'internal' || r.state !== HandshakeState.ACTIVE) continue
    if (!rowProvesLocalSandboxToHostForHostAi(r)) continue
    const hid = String(r.handshake_id ?? '').trim()
    if (hid) return hid
  }
  return undefined
}

export type ResolveSandboxInferenceTargetOptions = {
  handshakeId?: string
}

function logResolveDecision(decision: {
  kind: SandboxInferenceTarget['kind']
  reason: string
  handshakeId?: string
}): void {
  console.log(
    `[SBX_INFERENCE_ROUTE_RESOLVE] ${JSON.stringify({
      kind: decision.kind,
      reason: decision.reason,
      handshake_id: decision.handshakeId ?? null,
      timestamp: new Date().toISOString(),
    })}`,
  )
}

export async function resolveSandboxInferenceTarget(
  options: ResolveSandboxInferenceTargetOptions = {},
): Promise<SandboxInferenceTarget> {
  const localOk = await probeLocalSandboxOllama()
  if (localOk) {
    logResolveDecision({ kind: 'local_sandbox', reason: 'local_probe_ok' })
    return {
      kind: 'local_sandbox',
      baseUrl: LOCAL_SANDBOX_BASE_URL,
      execution_transport: 'local_ollama',
    }
  }

  const resolvedHandshake =
    typeof options.handshakeId === 'string' && options.handshakeId.trim()
      ? options.handshakeId.trim()
      : await resolveActiveSandboxToHostHandshakeId()

  if (!resolvedHandshake) {
    logResolveDecision({
      kind: 'unavailable',
      reason: 'no_local_ollama_no_cross_device_host',
      handshakeId: undefined,
    })
    return {
      kind: 'unavailable',
      reason: 'no_local_ollama_no_cross_device_host',
      detail: 'no_internal_sandbox_host_handshake',
    }
  }

  const candidate = getSandboxOllamaDirectRouteCandidate(resolvedHandshake)
  const baseTrim = typeof candidate?.base_url === 'string' ? candidate.base_url.trim() : ''
  const ownerTrim =
    typeof candidate?.endpoint_owner_device_id === 'string' ? candidate.endpoint_owner_device_id.trim() : ''
  /**
   * Candidates are only persisted when acceptance passes; `{ base_url }` present is authoritative.
   * If handshake exists but maps empty (`evaluateSandboxHostAi…` rejected or evicted): caps not usable.
   */
  if (!candidate || !baseTrim || !ownerTrim) {
    logResolveDecision({
      kind: 'unavailable',
      reason: 'cross_device_caps_not_accepted',
      handshakeId: resolvedHandshake,
    })
    return {
      kind: 'unavailable',
      reason: 'cross_device_caps_not_accepted',
      detail: `handshake=${resolvedHandshake}`,
    }
  }

  logResolveDecision({ kind: 'cross_device', reason: 'ollama_direct_candidate', handshakeId: resolvedHandshake })

  return {
    kind: 'cross_device',
    baseUrl: baseTrim.replace(/\/$/, ''),
    execution_transport: 'ollama_direct',
    handshakeId: resolvedHandshake,
    endpointOwnerDeviceId: ownerTrim,
  }
}

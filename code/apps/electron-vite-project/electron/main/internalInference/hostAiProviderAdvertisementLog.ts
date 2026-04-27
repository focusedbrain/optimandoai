/**
 * [HOST_AI_PROVIDER_ADVERTISEMENT] diagnostics — uses `getHandshakeDbForInternalInference` (ledger / SSO),
 * same DB class as internal inference / P2P config, not `handshake/db.ts` (CRUD-only, no DB accessor export).
 */

import { listHandshakeRecords } from '../handshake/db'
import { HandshakeState } from '../handshake/types'
import { getInstanceId, getOrchestratorMode, isSandboxMode } from '../orchestrator/orchestratorModeStore'
import { getHandshakeDbForInternalInference } from './dbAccess'
import { getEffectiveHostAiRoleForHandshake, getHostAiLedgerRoleSummaryFromDb } from './hostAiEffectiveRole'
import { getHostInternalInferencePolicy } from './hostInferencePolicyStore'
import {
  getHostPublishedMvpDirectP2pIngestUrl,
  hostDirectP2pAdvertisementHeaders,
  P2P_DIRECT_P2P_ENDPOINT_HEADER,
} from './p2pEndpointRepair'
import { hasActiveInternalLedgerLocalHostPeerSandboxForHostUi } from './listInferenceTargets'

export type HostAiProviderAdvertisementPayload = {
  db_open_ok: boolean
  current_device_id: string
  /** Persisted `orchestrator-mode.json` — hint only, not authority for Host AI. */
  configured_mode: string
  /**
   * Role implied by the sandbox file: `isSandboxMode()` (same as `configured_mode` mapping).
   * For diagnostics; compare to `host_ai_ledger` when troubleshooting misconfiguration.
   */
  orchestrator_file_implies: 'sandbox' | 'host'
  /** Ledger-based rows used elsewhere (Sandbox→Host vs Host↔Sandbox presence). */
  local_derived_role: 'sandbox' | 'host' | null
  host_published_direct_endpoint: string | null
  /** True when `hostDirectP2pAdvertisementHeaders` would attach `X-BEAP-Direct-P2P-Endpoint`. */
  advertisement_headers_can_generate: boolean
  /**
   * Host AI **product** role for this log line: ledger-effective (`sandbox` or `host`) when known;
   * if ledger is `none`/`mixed`, falls back to `orchestrator_file_implies` (hint only).
   * @deprecated Contrast with `orchestrator_file_implies` — do not use orchestrator as authority.
   */
  role: 'sandbox' | 'host'
  ollama_ok: boolean
  models_count: number
  /**
   * True when this instance may **serve** Host AI to a paired sandbox: ledger = host, policy on, and
   * not gated on `orchestrator-mode.json` (orchestrator file is a **hint** only).
   */
  advertised_as_host_ai: boolean
  /** Same as `host_published_direct_endpoint` (legacy field name in logs). */
  endpoint: string | null
  endpoint_owner_device_id: string
  /**
   * First ACTIVE internal row where this device can publish Host AI (debugging); unrelated to BEAP
   * relay `handshake_id` in `p2p_host_ai_direct_beap_ad` bodies.
   */
  handshake_id: string | null
  active_internal_ledger_sandbox_to_host: boolean
  active_internal_ledger_host_peer_sandbox: boolean
  host_internal_merge_would_run: boolean
  ttl_ms: number | null
  /**
   * Authoritative for Host AI transport (publish vs probe). `role_source` is always `handshake` when
   * a ledger row classifies the device; `orchestrator_mismatch` surfaces config hint vs ledger only.
   */
  host_ai_ledger: {
    effective_host_ai_role: 'host' | 'sandbox' | 'none' | 'mixed'
    can_publish_host_endpoint: boolean
    can_probe_host_endpoint: boolean
    any_orchestrator_mismatch: boolean
    role_source: 'handshake'
  }
}

export async function buildHostAiProviderAdvertisementPayload(input: {
  ledgerProvesInternalSandboxToHost: boolean
  mergeHostInternalInference: boolean
  ollamaDiscoveryOk: boolean
  ollamaModelCount: number
}): Promise<HostAiProviderAdvertisementPayload> {
  const dbProv = await getHandshakeDbForInternalInference()
  const db_open_ok = dbProv != null
  /** Local MVP LAN BEAP (always); only exposed as "Host published" when ledger allows publishing. */
  const mvpListenerUrl = dbProv ? getHostPublishedMvpDirectP2pIngestUrl(dbProv) : null
  const headers = dbProv ? hostDirectP2pAdvertisementHeaders(dbProv) : {}
  const headerVal = headers[P2P_DIRECT_P2P_ENDPOINT_HEADER]
  const headersTechnicallyGeneratable =
    typeof headerVal === 'string' && headerVal.trim().length > 0

  const polH = getHostInternalInferencePolicy()
  const hostSidePair = await hasActiveInternalLedgerLocalHostPeerSandboxForHostUi()
  const orchestratorFileImplies: 'sandbox' | 'host' = isSandboxMode() ? 'sandbox' : 'host'

  let local_derived_role: 'sandbox' | 'host' | null = null
  if (input.ledgerProvesInternalSandboxToHost) {
    local_derived_role = 'sandbox'
  } else if (hostSidePair) {
    local_derived_role = 'host'
  }

  const mode = getOrchestratorMode().mode
  const currentId = getInstanceId().trim()
  const ledger = dbProv
    ? getHostAiLedgerRoleSummaryFromDb(dbProv, currentId, String(mode))
    : {
        can_publish_host_endpoint: false,
        can_probe_host_endpoint: false,
        any_orchestrator_mismatch: false,
        effective_host_ai_role: 'none' as const,
      }

  const advertisedAsHostAi =
    ledger.can_publish_host_endpoint && polH?.allowSandboxInference === true

  /** Only the ledger **host** may publish a Host direct endpoint; `configured_mode` is never authority. */
  const mayPublishAsHost = ledger.can_publish_host_endpoint
  const hostPublishedEndpoint = mayPublishAsHost && mvpListenerUrl ? mvpListenerUrl : null
  const advertisement_headers_can_generate = mayPublishAsHost && headersTechnicallyGeneratable
  /** `role` in this log: ledger-effective role for Host AI (not orchestrator `configured_mode` alone). */
  const roleForHostAiLog: 'sandbox' | 'host' =
    ledger.effective_host_ai_role === 'host'
      ? 'host'
      : ledger.effective_host_ai_role === 'sandbox'
        ? 'sandbox'
        : orchestratorFileImplies

  let diagnosticPublishHandshakeId: string | null = null
  if (dbProv) {
    try {
      const rows = listHandshakeRecords(dbProv as any, { state: HandshakeState.ACTIVE, handshake_type: 'internal' })
      for (const r0 of rows) {
        const eff = getEffectiveHostAiRoleForHandshake(r0, currentId, String(mode))
        if (eff.can_publish_host_endpoint) {
          diagnosticPublishHandshakeId = (r0.handshake_id ?? '').trim() || null
          break
        }
      }
    } catch {
      diagnosticPublishHandshakeId = null
    }
  }

  // Explicit line for support: handshake-derived roles vs orchestrator file hint.
  if (db_open_ok) {
    console.log(
      `[HOST_AI_EFFECTIVE_ROLE] ` +
        JSON.stringify({
          orchestrator_persisted_mode: String(mode),
          orchestrator_file_implies: orchestratorFileImplies,
          host_ai_ledger: {
            effective_host_ai_role: ledger.effective_host_ai_role,
            can_publish_host_endpoint: ledger.can_publish_host_endpoint,
            can_probe_host_endpoint: ledger.can_probe_host_endpoint,
            any_orchestrator_mismatch: ledger.any_orchestrator_mismatch,
            role_source: 'handshake' as const,
          },
        }),
    )
  }

  return {
    db_open_ok,
    current_device_id: currentId,
    configured_mode: String(mode),
    orchestrator_file_implies: orchestratorFileImplies,
    local_derived_role,
    host_published_direct_endpoint: hostPublishedEndpoint,
    advertisement_headers_can_generate,
    role: roleForHostAiLog,
    ollama_ok: input.ollamaDiscoveryOk,
    models_count: input.ollamaModelCount,
    advertised_as_host_ai: advertisedAsHostAi,
    endpoint: hostPublishedEndpoint,
    endpoint_owner_device_id: getInstanceId().trim(),
    handshake_id: diagnosticPublishHandshakeId,
    active_internal_ledger_sandbox_to_host: input.ledgerProvesInternalSandboxToHost,
    active_internal_ledger_host_peer_sandbox: hostSidePair,
    host_internal_merge_would_run: input.mergeHostInternalInference,
    ttl_ms: polH?.timeoutMs ?? null,
    host_ai_ledger: {
      effective_host_ai_role: ledger.effective_host_ai_role,
      can_publish_host_endpoint: ledger.can_publish_host_endpoint,
      can_probe_host_endpoint: ledger.can_probe_host_endpoint,
      any_orchestrator_mismatch: ledger.any_orchestrator_mismatch,
      role_source: 'handshake',
    },
  }
}

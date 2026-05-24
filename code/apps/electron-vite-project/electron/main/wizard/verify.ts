/**
 * Synthetic edge→local verification for wizard Step 6 — Phase 4 (P4.4).
 */

import { createPodClient } from '@repo/pod-client'
import type { EdgeReplica } from '@repo/pod-client'

import {
  applyEdgeTierSettingsAndRestartPod,
  type EdgeTierPodVault,
} from '../edge-tier/podLifecycle.js'
import {
  loadEdgeTierSettings,
  saveEdgeTierSettings,
  type EdgeReplica as SettingsReplica,
} from '../edge-tier/settings.js'

export interface VerifyEdgeRoundTripResult {
  readonly verified: boolean
  readonly reason?: string
}

function buildSyntheticRawInput(): string {
  const capsuleJson = JSON.stringify({
    subject: 'wizard-edge-verify',
    body: '<p>BEAP wizard synthetic verify</p>',
    transport_plaintext: '',
  })
  const payloadB64 = Buffer.from(capsuleJson).toString('base64')
  const pkg = {
    header: {
      version: '1.0',
      encoding: 'pBEAP',
      sender_fingerprint: 'wizard-verify-fp',
      template_hash: 'd'.repeat(64),
      policy_hash: 'e'.repeat(64),
      content_hash: 'f'.repeat(64),
    },
    metadata: { created_at: Date.now() },
    payload: payloadB64,
    signature: {
      signature: Buffer.alloc(64).toString('base64'),
      algorithm: 'Ed25519',
      keyId: 'wizard-verify',
    },
  }
  return JSON.stringify({
    body: JSON.stringify(pkg),
    source_type: 'api',
    mime_type: 'application/json',
    depackage_keys: { x25519_priv_b64: Buffer.alloc(32, 1).toString('base64') },
  })
}

function mapReplica(replica: SettingsReplica): EdgeReplica {
  return {
    host: replica.host,
    port: replica.port,
    edge_pod_id: replica.edge_pod_id,
    public_key: replica.edge_public_key,
    attestation_jwt: replica.sso_attestation_jwt,
  }
}

export interface VerifyEdgeRoundTripDeps {
  readonly vault: EdgeTierPodVault
  readonly localPodBaseUrl?: string
  readonly ingest?: (
    replica: EdgeReplica,
    rawInput: string,
  ) => Promise<{ ok: boolean; reason?: string }>
  readonly restartPod?: (vault: EdgeTierPodVault, enabled: boolean) => Promise<void>
}

async function defaultIngest(
  replica: EdgeReplica,
  rawInput: string,
  localBaseUrl: string,
): Promise<{ ok: boolean; reason?: string }> {
  const client = createPodClient({
    baseUrl: localBaseUrl,
    requestTimeoutMs: 30_000,
  })
  client.configureEdgeTier([replica], 'reject')
  try {
    const result = await client.ingest(rawInput, 'api', { message_id: 'wizard-verify' })
    const body = (result.body ?? {}) as Record<string, unknown>
    if (body['valid'] === false) {
      return { ok: false, reason: String(body['reason'] ?? 'local verification rejected capsule') }
    }
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Run synthetic BEAP edge→local round-trip, then enable edge tier on success.
 */
export async function verifyEdgeRoundTripAndEnable(
  replicaIndex: number,
  deps: VerifyEdgeRoundTripDeps,
): Promise<VerifyEdgeRoundTripResult> {
  const settings = loadEdgeTierSettings()
  const replica = settings.replicas[replicaIndex]
  if (!replica) {
    return { verified: false, reason: `No deployed replica at index ${replicaIndex}` }
  }

  const previousEnabled = settings.enabled
  const localBaseUrl = deps.localPodBaseUrl ?? process.env['WR_POD_BASE_URL'] ?? 'http://127.0.0.1:18100'

  const restart = deps.restartPod ?? (async (vault, enabled) => {
    const current = loadEdgeTierSettings()
    await applyEdgeTierSettingsAndRestartPod(vault, { ...current, enabled })
  })

  // Start LOCAL_VERIFY pod for cert verification (temporary enable if needed).
  await restart(deps.vault, true)

  const ingest =
    deps.ingest ??
    ((edgeReplica, rawInput) => defaultIngest(edgeReplica, rawInput, localBaseUrl))

  const ingestResult = await ingest(mapReplica(replica), buildSyntheticRawInput())
  if (!ingestResult.ok) {
    if (!previousEnabled) {
      const current = loadEdgeTierSettings()
      saveEdgeTierSettings({ ...current, enabled: false })
      await restart(deps.vault, false)
    }
    return { verified: false, reason: ingestResult.reason ?? 'Synthetic verify failed' }
  }

  const current = loadEdgeTierSettings()
  if (!current.enabled) {
    await applyEdgeTierSettingsAndRestartPod(deps.vault, { ...current, enabled: true })
  }

  return { verified: true }
}

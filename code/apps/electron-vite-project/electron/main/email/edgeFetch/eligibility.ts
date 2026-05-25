/**
 * Eligibility checks for per-account edge fetch migration.
 */

import { ensureSession, getCachedUserInfo } from '../../../../src/auth/session.js'
import { resolveTier, type Tier } from '../../../../src/auth/capabilities.js'
import { isPaidTier } from '../../wizard/handlers.js'
import { loadEdgeTierSettings, isEdgeTierActiveForRouting } from '../../edge-tier/settings.js'
import type { EdgeFetchEligibility } from './types.js'
import { accountSupportsEdgeFetch, edgeFetchEligibilityForAccount } from './edgeFetchRules.js'

export { accountSupportsEdgeFetch, edgeFetchEligibilityForAccount }

export async function resolveEdgeFetchEligibility(): Promise<EdgeFetchEligibility> {
  const settings = loadEdgeTierSettings()
  const replicas = settings.replicas.map((r) => ({
    edge_pod_id: r.edge_pod_id,
    host: r.host,
    port: r.port,
  }))

  let tier: Tier = 'free'
  try {
    await ensureSession(false)
    const info = getCachedUserInfo()
    tier = info?.canonical_tier ?? resolveTier(info?.wrdesk_plan, info?.roles ?? [], info?.sso_tier)
  } catch {
    /* keep free */
  }

  const paid = isPaidTier(tier)
  const edgeActive = isEdgeTierActiveForRouting(settings)
  const edgeReady = paid && edgeActive && replicas.length > 0

  if (!paid) {
    return {
      canMigrate: false,
      edgeReady: false,
      isPaidTier: false,
      replicas,
      reason: 'Edge email fetch requires a paid plan.',
    }
  }
  if (!edgeActive || replicas.length === 0) {
    return {
      canMigrate: false,
      edgeReady: false,
      isPaidTier: true,
      replicas,
      reason: 'Deploy an edge replica first (Edge tier wizard).',
    }
  }

  return { canMigrate: true, edgeReady: true, isPaidTier: true, replicas }
}

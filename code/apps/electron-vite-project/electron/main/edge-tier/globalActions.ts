/**
 * Dashboard global edge-tier actions — Phase 4 (P4.8).
 */

import {
  loadEdgeTierSettings,
  setEdgeTierFallbackPolicy,
  type EdgeFallbackPolicy,
} from './settings.js'
import { applyEdgeTierSettingsAndRestartPod, type EdgeTierPodVault } from './podLifecycle.js'
import { zeroizeBuffer } from '../security/zeroize.js'
import {
  redeployReplica,
  type ReplicaActionDeps,
  type ReplicaActionInput,
} from './replicaActions.js'

/** UI-facing fallback policy labels (maps to persisted EdgeFallbackPolicy). */
export type DashboardFallbackPolicy = 'reject' | 'downgrade_with_badge'

export function toStoredFallbackPolicy(policy: DashboardFallbackPolicy): EdgeFallbackPolicy {
  return policy === 'downgrade_with_badge' ? 'local_only' : 'reject'
}

export function toDashboardFallbackPolicy(policy: EdgeFallbackPolicy): DashboardFallbackPolicy {
  return policy === 'local_only' ? 'downgrade_with_badge' : 'reject'
}

export type GlobalActionEventKind = 'log' | 'stage' | 'done' | 'error'

export interface GlobalActionPartialFailure {
  failed_index: number
  failed_replica_id: string
  completed_replica_ids: string[]
  total_replicas: number
}

export interface GlobalActionEvent {
  readonly kind: GlobalActionEventKind
  readonly message: string
  readonly stage_name?: string
  readonly replica_index?: number
  readonly replica_id?: string
  readonly total_replicas?: number
  readonly partial_failure?: GlobalActionPartialFailure
}

export interface RotateAllEdgeKeysInput {
  readonly sshUser: string
  readonly sshPort?: number
  readonly sshKey: Buffer
  readonly passphrase?: Buffer
}

export async function pauseEdgeTier(vault: EdgeTierPodVault): Promise<void> {
  const current = loadEdgeTierSettings()
  if (!current.enabled) return
  await applyEdgeTierSettingsAndRestartPod(vault, { ...current, enabled: false })
}

export function updateFallbackPolicy(policy: DashboardFallbackPolicy): EdgeFallbackPolicy {
  return setEdgeTierFallbackPolicy(toStoredFallbackPolicy(policy)).fallback_policy
}

export async function* rotateAllEdgeKeys(
  input: RotateAllEdgeKeysInput,
  deps: ReplicaActionDeps,
): AsyncGenerator<GlobalActionEvent> {
  try {
    const initial = loadEdgeTierSettings()
    const targets = initial.replicas.map((r) => ({ host: r.host, port: r.port }))
    const total = targets.length

    if (total === 0) {
      yield { kind: 'error', message: 'No replicas configured — nothing to rotate.', stage_name: 'rotate' }
      return
    }

    yield {
      kind: 'stage',
      stage_name: 'rotate',
      message: `Rotating edge keys on ${total} replica${total === 1 ? '' : 's'}…`,
      total_replicas: total,
    }

    const completedReplicaIds: string[] = []

    for (let index = 0; index < targets.length; index++) {
      const target = targets[index]!
      const settings = loadEdgeTierSettings()
      const replica = settings.replicas.find((r) => r.host === target.host && r.port === target.port)
      if (!replica) {
        yield {
          kind: 'error',
          message: `Replica at ${target.host}:${target.port} no longer exists.`,
          stage_name: 'rotate',
          replica_index: index,
          total_replicas: total,
          partial_failure: {
            failed_index: index,
            failed_replica_id: '',
            completed_replica_ids: completedReplicaIds,
            total_replicas: total,
          },
        }
        return
      }

      yield {
        kind: 'stage',
        stage_name: 'rotate',
        message: `Redeploying replica ${index + 1} of ${total} (${replica.host}) with a new keypair…`,
        replica_index: index,
        replica_id: replica.edge_pod_id,
        total_replicas: total,
      }

      const redeployInput: ReplicaActionInput = {
        replicaId: replica.edge_pod_id,
        sshUser: input.sshUser,
        sshPort: input.sshPort,
        sshKey: Buffer.from(input.sshKey),
        passphrase: input.passphrase ? Buffer.from(input.passphrase) : undefined,
      }

      let failedMessage: string | null = null
      for await (const event of redeployReplica(redeployInput, deps)) {
        yield {
          kind: event.kind,
          message: event.message,
          stage_name: event.stage_name ?? 'redeploy',
          replica_index: index,
          replica_id: replica.edge_pod_id,
          total_replicas: total,
        }
        if (event.kind === 'error') {
          failedMessage = event.message
          break
        }
        if (event.kind === 'done' && event.result?.newReplica) {
          completedReplicaIds.push(event.result.newReplica.edge_pod_id)
        }
      }

      if (failedMessage) {
        yield {
          kind: 'error',
          message: `Rotation failed on replica ${index + 1} of ${total}: ${failedMessage}`,
          stage_name: 'rotate',
          replica_index: index,
          replica_id: replica.edge_pod_id,
          total_replicas: total,
          partial_failure: {
            failed_index: index,
            failed_replica_id: replica.edge_pod_id,
            completed_replica_ids: completedReplicaIds,
            total_replicas: total,
          },
        }
        return
      }
    }

    yield {
      kind: 'done',
      message: `Edge keys rotated on all ${total} replicas.`,
      stage_name: 'rotate',
      total_replicas: total,
    }
  } finally {
    zeroizeBuffer(input.sshKey)
    zeroizeBuffer(input.passphrase)
  }
}

/** Collect events for tests. */
export async function collectGlobalActionEvents(
  generator: AsyncGenerator<GlobalActionEvent>,
): Promise<GlobalActionEvent[]> {
  const events: GlobalActionEvent[] = []
  for await (const event of generator) {
    events.push(event)
  }
  return events
}

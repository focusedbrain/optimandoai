/**
 * Host confirmation helper for destructive replica actions.
 */

export function canConfirmDestructiveReplicaAction(
  hostConfirm: string,
  expectedHost: string,
): boolean {
  return hostConfirm.trim() === expectedHost.trim()
}

export type ReplicaActionKind = 'restart' | 'redeploy' | 'remove'

export function replicaActionRequiresHostConfirm(action: ReplicaActionKind): boolean {
  return action === 'redeploy' || action === 'remove'
}

export function replicaActionTitle(action: ReplicaActionKind): string {
  switch (action) {
    case 'restart':
      return 'Restart replica'
    case 'redeploy':
      return 'Redeploy replica'
    case 'remove':
      return 'Remove replica'
  }
}

export function replicaActionDescription(action: ReplicaActionKind, host: string): string {
  switch (action) {
    case 'restart':
      return `Restart the pod on ${host}. The edge private key is unchanged.`
    case 'redeploy':
      return `Stop and remove the pod on ${host}, then deploy a fresh REMOTE_EDGE pod with a new keypair. The old key will no longer work.`
    case 'remove':
      return `Stop and remove the pod on ${host}, then delete this replica from your edge tier settings.`
  }
}

/**
 * Discard quarantined message — local delete + edge SSH cleanup (P5.6).
 */

import { shellQuote } from './ssh/deploy.js'
import type { EdgeTierPodVault } from './podLifecycle.js'
import { VaultLockedError } from './accountKeyStorage.js'
import {
  connectReplicaActionSsh,
  findEdgeReplica,
  type ReplicaActionInput,
  type ReplicaActionSshRunner,
} from './replicaActions.js'
import { loadReplicaSshCredentials } from './replicaSshStorage.js'
import { sshSecretBuffersFromStrings } from '../security/sshSecretBuffers.js'
import { zeroizeBuffer } from '../security/zeroize.js'
import { findContainerSpec } from './supervisor/containers.js'
import { EDGE_QUARANTINE_DIR } from './supervisor/quarantinePickup.js'
import { deleteLocalQuarantineEntry } from './supervisor/quarantineStore.js'
import { appendSupervisorAudit } from './supervisor/auditLog.js'
import {
  confirmationMatchesQuarantineEntry,
  getQuarantineEntryMetadata,
} from './quarantineDashboard.js'

export interface DiscardQuarantineInput {
  replicaId: string
  hash: string
  confirmationText: string
  sshUser?: string
  sshKey?: Buffer
  sshPort?: number
  passphrase?: Buffer
}

export interface DiscardQuarantineResult {
  ok: boolean
  error?: string
  needs_ssh?: boolean
}

async function deleteRemoteQuarantineEntry(
  ssh: ReplicaActionSshRunner,
  hash: string,
): Promise<void> {
  const containerName = findContainerSpec('mail-fetcher').containerName
  const remotePath = `${EDGE_QUARANTINE_DIR}/${hash}`
  await ssh.run(
    `podman exec ${shellQuote(containerName)} rm -rf ${shellQuote(remotePath)} 2>/dev/null || true`,
  )
}

function resolveSshInput(
  replicaId: string,
  vault: EdgeTierPodVault,
  input: DiscardQuarantineInput,
): ReplicaActionInput | { needs_ssh: true } {
  if (input.sshKey && input.sshUser) {
    return {
      replicaId,
      sshUser: input.sshUser,
      sshPort: input.sshPort,
      sshKey: input.sshKey,
      passphrase: input.passphrase,
    }
  }

  try {
    const stored = loadReplicaSshCredentials(replicaId, vault)
    if (!stored) {
      return { needs_ssh: true }
    }
    const secrets = sshSecretBuffersFromStrings(stored.sshKey, stored.passphrase)
    return {
      replicaId,
      sshUser: stored.sshUser,
      sshPort: stored.sshPort,
      sshKey: secrets.sshKey,
      passphrase: secrets.passphrase,
    }
  } catch (err) {
    if (err instanceof VaultLockedError) {
      return { needs_ssh: true }
    }
    throw err
  }
}

export async function discardQuarantineEntry(
  input: DiscardQuarantineInput,
  vault: EdgeTierPodVault,
): Promise<DiscardQuarantineResult> {
  const metadata = getQuarantineEntryMetadata(input.replicaId, input.hash)
  if (!metadata) {
    return { ok: false, error: 'Quarantine entry not found' }
  }

  if (!confirmationMatchesQuarantineEntry(metadata, input.confirmationText)) {
    return {
      ok: false,
      error: 'Confirmation text must match envelope_from or envelope_subject_filtered exactly',
    }
  }

  const sshInput = resolveSshInput(input.replicaId, vault, input)
  if ('needs_ssh' in sshInput) {
    return { ok: false, needs_ssh: true, error: 'SSH credentials required to delete edge copy' }
  }

  const confirmationTimestamp = new Date().toISOString()
  let ssh: ReplicaActionSshRunner | null = null

  try {
    const replica = findEdgeReplica(input.replicaId)
    ssh = await connectReplicaActionSsh(replica, sshInput)
    await deleteRemoteQuarantineEntry(ssh, input.hash)
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    await ssh?.disconnect()
    zeroizeBuffer(sshInput.sshKey)
    zeroizeBuffer(sshInput.passphrase)
  }

  deleteLocalQuarantineEntry(input.replicaId, input.hash)

  appendSupervisorAudit({
    event: 'message_discarded',
    replica_id: input.replicaId,
    container_role: metadata.failed_container_role,
    message_hash: input.hash,
    envelope_from: metadata.envelope_from,
    confirmation_timestamp: confirmationTimestamp,
    success: true,
  })

  return { ok: true }
}

/** Parse discard IPC payload with optional inline SSH credentials. */
export function parseDiscardQuarantinePayload(raw: unknown): DiscardQuarantineInput {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Invalid discard quarantine input')
  }
  const o = raw as Record<string, unknown>
  const replicaId = o.replicaId
  const hash = o.hash
  const confirmationText = o.confirmationText
  if (typeof replicaId !== 'string' || replicaId.length === 0 || replicaId.length > 200) {
    throw new Error('replicaId: expected non-empty string')
  }
  if (typeof hash !== 'string' || hash.length === 0 || hash.length > 128) {
    throw new Error('hash: expected non-empty string')
  }
  if (typeof confirmationText !== 'string') {
    throw new Error('confirmationText: expected string')
  }

  const sshKeyString = typeof o.sshKey === 'string' && o.sshKey.length > 0 ? o.sshKey : undefined
  const sshUser = typeof o.sshUser === 'string' && o.sshUser.length > 0 ? o.sshUser : undefined
  const passphraseString =
    typeof o.passphrase === 'string' && o.passphrase.length > 0 ? o.passphrase : undefined
  const secrets =
    sshKeyString && sshUser
      ? sshSecretBuffersFromStrings(sshKeyString, passphraseString)
      : null

  const sshPort =
    o.sshPort == null
      ? undefined
      : typeof o.sshPort === 'number'
        ? o.sshPort
        : Number(o.sshPort)

  return {
    replicaId,
    hash,
    confirmationText,
    sshUser,
    sshKey: secrets?.sshKey,
    sshPort: sshPort != null && Number.isInteger(sshPort) ? sshPort : undefined,
    passphrase: secrets?.passphrase,
  }
}

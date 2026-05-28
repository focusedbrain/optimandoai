/**
 * Relay mail-fetch credentials to a paired Edge Agent (PR6).
 */

import { wrapCredentialPlaintext } from '@repo/agent-credential-envelope'

import type { EmailAccountConfig } from '../email/types.js'
import {
  encryptAccountCredentialBundle,
  mapProviderToEmailFetch,
} from '../email/edgeFetch/credentialBundle.js'
import { storeWrappedAccountKey, type EdgeTierPodVault } from '../edge-tier/accountKeyStorage.js'
import type { EdgeReplica } from '../edge-tier/settings.js'
import { getHandshakeDbForInternalInference } from '../internalInference/dbAccess.js'
import { resolveAgentConnection } from './resolveAgentConnection.js'
import {
  activateAgentCredentials,
  relayCredentialsToAgent,
} from './agentApiClient.js'

export async function transferAccountCredentialsToAgent(
  replica: EdgeReplica,
  account: EmailAccountConfig,
  vault: EdgeTierPodVault,
): Promise<void> {
  const fetchProvider = mapProviderToEmailFetch(account.provider)
  if (!fetchProvider) throw new Error('Unsupported provider for edge fetch')

  const db = await getHandshakeDbForInternalInference()
  if (!db) throw new Error('Handshake database unavailable for credential relay')
  const { agentEncryptionPublicKeyB64: encPub } = resolveAgentConnection(replica, db)

  const { encryptedBundle, accountKeyHex } = encryptAccountCredentialBundle(account)
  const wrappedAccountKey = storeWrappedAccountKey(account.id, accountKeyHex, vault)

  const envelope = wrapCredentialPlaintext(
    encPub,
    {
      encrypted_bundle: encryptedBundle,
      account_key_hex: accountKeyHex,
      wrapped_account_key: wrappedAccountKey,
    },
    `account:${account.id}`,
  )

  await relayCredentialsToAgent(replica, {
    account_id: account.id,
    display_name: account.email || account.id,
    provider: fetchProvider,
    envelope,
  })

  await activateAgentCredentials(replica)
}

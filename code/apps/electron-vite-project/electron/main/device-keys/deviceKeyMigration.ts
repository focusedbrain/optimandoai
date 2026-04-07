/**
 * Device Key Migration
 *
 * One-time migration: moves the X25519 device keypair from
 * `chrome.storage.local` (extension) to the orchestrator DB.
 *
 * Called once on app startup, after the orchestrator DB is open and
 * the `device_keys` table exists.
 *
 * Rules:
 *   - If the key already exists in the DB → skip (idempotent).
 *   - If the extension has the key → migrate it to the DB, then tell the
 *     extension to delete it from chrome.storage.
 *   - If neither side has the key (first run, or key was already lost) →
 *     generate a new random keypair and store it in the DB.
 *     This is the ONLY place in the entire codebase that is allowed to
 *     generate a new X25519 device keypair.
 *
 * Extension communication:
 *   The migration communicates with the extension via the existing
 *   WebSocket RPC channel (same mechanism as VAULT_RPC). Two custom
 *   RPC methods are used:
 *   - `beap.exportDeviceKey`  → extension returns the keypair from chrome.storage
 *   - `beap.deleteDeviceKey`  → extension deletes the key from chrome.storage
 *
 *   These methods are handled by the extension's background.ts. If the
 *   extension is not connected (WS not open), the migration is deferred to
 *   the next startup — the key stays in chrome.storage until the migration
 *   succeeds.
 */

import { x25519 } from '@noble/curves/ed25519'
import {
  storeDeviceX25519KeyPair,
  deviceKeyExists,
  DeviceKeyAlreadyExistsError,
} from './deviceKeyStore'

// ── Key ID derivation (matches extension's sha256-based keyId) ────────────────

async function computeKeyId(publicKeyBytes: Uint8Array): Promise<string> {
  const { createHash } = await import('crypto')
  const hash = createHash('sha256').update(publicKeyBytes).digest('hex')
  return hash.substring(0, 16)
}

// ── WebSocket RPC to extension (fire-and-forget style) ───────────────────────

/**
 * Request the extension to export its stored X25519 device keypair.
 * Returns the keypair if found, or null if the extension is not connected
 * or doesn't have the key.
 *
 * `sendRpcToExtension` is injected by the caller (main.ts) so this module
 * doesn't need to import the WebSocket coordinator directly.
 */
export type ExtensionRpcSender = (
  method: string,
  params: Record<string, unknown>,
) => Promise<Record<string, unknown> | null>

async function requestExtensionDeviceKey(
  sendRpc: ExtensionRpcSender,
): Promise<{ publicKeyB64: string; privateKeyB64: string } | null> {
  try {
    const response = await sendRpc('beap.exportDeviceKey', {})
    if (!response) return null
    if (
      response.found === true &&
      typeof response.publicKeyB64 === 'string' &&
      typeof response.privateKeyB64 === 'string' &&
      response.publicKeyB64.length > 0 &&
      response.privateKeyB64.length > 0
    ) {
      return {
        publicKeyB64: response.publicKeyB64,
        privateKeyB64: response.privateKeyB64,
      }
    }
    return null
  } catch (e) {
    console.warn('[DEVICE-KEY-MIGRATION] Failed to contact extension for device key export:', e)
    return null
  }
}

async function requestExtensionDeleteDeviceKey(sendRpc: ExtensionRpcSender): Promise<void> {
  try {
    await sendRpc('beap.deleteDeviceKey', {})
    console.log('[DEVICE-KEY-MIGRATION] Extension confirmed device key deletion from chrome.storage')
  } catch (e) {
    console.warn('[DEVICE-KEY-MIGRATION] Could not confirm chrome.storage deletion (non-fatal):', e)
  }
}

// ── Generate a new keypair (only called from this file) ───────────────────────

async function generateNewDeviceKeyPair(): Promise<{ publicKeyB64: string; privateKeyB64: string; keyId: string }> {
  const privateKeyBytes = x25519.utils.randomPrivateKey()
  const publicKeyBytes = x25519.getPublicKey(privateKeyBytes)
  const keyId = await computeKeyId(publicKeyBytes)
  return {
    privateKeyB64: Buffer.from(privateKeyBytes).toString('base64'),
    publicKeyB64: Buffer.from(publicKeyBytes).toString('base64'),
    keyId,
  }
}

// ── Main migration function ───────────────────────────────────────────────────

/**
 * Run the device key migration. Safe to call on every startup — exits
 * immediately if the key is already in the DB.
 *
 * @param sendRpc  Function to send an RPC to the extension (see `ExtensionRpcSender`).
 *                 Pass `null` if the extension is not connected.
 *                 When `null` and no key exists in the DB, migration is DEFERRED
 *                 (returns false) rather than generating a new key. The caller
 *                 must retry once the extension connects.
 *
 * @returns `true` if migration completed (key now in DB), `false` if deferred.
 */
export async function migrateDeviceKeyFromExtension(
  sendRpc: ExtensionRpcSender | null,
): Promise<boolean> {
  // ── 1. Already migrated ───────────────────────────────────────────────────
  if (await deviceKeyExists()) {
    console.log('[DEVICE-KEY-MIGRATION] Key already in orchestrator DB — nothing to do')
    return true
  }

  // ── 2. Extension not connected — defer, do NOT generate ──────────────────
  if (!sendRpc) {
    console.warn(
      '[DEVICE-KEY-MIGRATION] Extension not connected and no key in DB. ' +
      'Deferring migration — will retry when extension connects. ' +
      'Do NOT use BEAP until migration completes.',
    )
    return false
  }

  // ── 3. Try to get the key from the extension ──────────────────────────────
  const extensionKey = await requestExtensionDeviceKey(sendRpc)

  if (extensionKey) {
    // ── 4a. Extension had the key — migrate it ────────────────────────────
    try {
      await storeDeviceX25519KeyPair({
        publicKeyB64: extensionKey.publicKeyB64,
        privateKeyB64: extensionKey.privateKeyB64,
        migratedFrom: 'chrome_storage_local',
      })
      console.log('[DEVICE-KEY-MIGRATION] ✅ Migrated X25519 device key from chrome.storage.local to orchestrator DB')

      // Tell extension to clean up (non-blocking — failure is non-fatal)
      await requestExtensionDeleteDeviceKey(sendRpc)
      return true
    } catch (e) {
      if (e instanceof DeviceKeyAlreadyExistsError) {
        console.log('[DEVICE-KEY-MIGRATION] Key appeared in DB concurrently — treating as success')
        return true
      }
      throw e
    }
  } else {
    // ── 4b. Extension confirmed no key — true first run, generate new ─────
    // We only reach here when the extension IS connected and explicitly
    // responded { found: false }. Generating is safe: there is no existing
    // key on either side.
    console.log(
      '[DEVICE-KEY-MIGRATION] Extension connected and confirmed no key in chrome.storage. ' +
      'Generating new keypair (true first run).',
    )
    const newKey = await generateNewDeviceKeyPair()
    try {
      await storeDeviceX25519KeyPair({
        publicKeyB64: newKey.publicKeyB64,
        privateKeyB64: newKey.privateKeyB64,
        migratedFrom: null,
      })
      console.log(
        '[DEVICE-KEY-MIGRATION] ✅ Generated new X25519 device keypair (keyId:', newKey.keyId, '). ',
      )
      return true
    } catch (e) {
      if (e instanceof DeviceKeyAlreadyExistsError) {
        console.log('[DEVICE-KEY-MIGRATION] Key appeared concurrently during generation — treating as success')
        return true
      }
      throw e
    }
  }
}

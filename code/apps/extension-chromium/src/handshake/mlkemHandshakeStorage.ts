/**
 * Persist local ML-KEM-768 secret keys per handshake (extension-only).
 * ML-KEM secrets are stored exclusively in the Electron encrypted SQLite DB
 * (local_mlkem768_secret_key_b64 column). This module retains only the read
 * path (getLocalMlkemSecret — legacy / fallback) and the delete path
 * (removeLocalMlkemSecret — called on handshake delete to clean up any
 * pre-existing entries written before this storage policy was enforced).
 */

const KEY_PREFIX = 'beap_mlkem768_secret_v1::'

function storageKey(handshakeId: string): string {
  return `${KEY_PREFIX}${handshakeId}`
}

export async function getLocalMlkemSecret(handshakeId: string): Promise<string | undefined> {
  if (!handshakeId?.trim()) return undefined
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return undefined
  const r = await chrome.storage.local.get(storageKey(handshakeId))
  const v = r[storageKey(handshakeId)]
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

export async function removeLocalMlkemSecret(handshakeId: string): Promise<void> {
  if (!handshakeId?.trim()) return
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return
  await chrome.storage.local.remove(storageKey(handshakeId))
}

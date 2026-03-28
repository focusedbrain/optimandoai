/**
 * Persist local ML-KEM-768 secret keys per handshake (extension-only).
 * Required for qBEAP receive: decapsulation uses the secret matching the public key
 * sent in initiate/accept. Stored in chrome.storage.local (device-local; not synced).
 */

const KEY_PREFIX = 'beap_mlkem768_secret_v1::'

function storageKey(handshakeId: string): string {
  return `${KEY_PREFIX}${handshakeId}`
}

export async function storeLocalMlkemSecret(handshakeId: string, secretKeyB64: string): Promise<void> {
  if (!handshakeId?.trim() || !secretKeyB64?.trim()) return
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return
  await chrome.storage.local.set({ [storageKey(handshakeId)]: secretKeyB64.trim() })
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

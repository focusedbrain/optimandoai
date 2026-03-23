/**
 * Anthropic API Key Storage (BYOK Vision)
 *
 * Stores the API key in chrome.storage.local for extension-only mode.
 * When Electron/vault is available, the handshake flow uses vault encryption.
 * This storage is used by the capsule builder Vision fallback.
 *
 * @version 1.0.0
 */

const STORAGE_KEY = 'anthropic_api_key_byok'

export async function hasAnthropicApiKey(): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return false
  const result = await chrome.storage.local.get(STORAGE_KEY)
  const key = result[STORAGE_KEY]
  return typeof key === 'string' && key.startsWith('sk-ant-') && key.length > 20
}

export async function getAnthropicApiKey(): Promise<string | null> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return null
  const result = await chrome.storage.local.get(STORAGE_KEY)
  const key = result[STORAGE_KEY]
  return typeof key === 'string' && key.startsWith('sk-ant-') ? key : null
}

export async function saveAnthropicApiKey(apiKey: string): Promise<void> {
  const trimmed = apiKey?.trim()
  if (!trimmed || !trimmed.startsWith('sk-ant-')) {
    throw new Error('API key must start with sk-ant-')
  }
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    throw new Error('Chrome storage not available')
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: trimmed })
}

export async function removeAnthropicApiKey(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return
  await chrome.storage.local.remove(STORAGE_KEY)
}

/**
 * Validate API key with a minimal Anthropic probe request.
 */
export async function validateAnthropicApiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  const trimmed = apiKey?.trim()
  if (!trimmed || !trimmed.startsWith('sk-ant-')) {
    return { valid: false, error: 'API key must start with sk-ant-' }
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': trimmed,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-20250514',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }],
      }),
      signal: AbortSignal.timeout(15_000),
    })

    if (response.ok) return { valid: true }
    const body = await response.json().catch(() => ({}))
    const errMsg = (body as { error?: { message?: string } })?.error?.message ?? `HTTP ${response.status}`
    return { valid: false, error: errMsg }
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : 'Could not validate API key',
    }
  }
}

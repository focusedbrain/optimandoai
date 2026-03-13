/**
 * Vault API Key Service
 *
 * Stores and retrieves encrypted BYOK API keys (currently Anthropic) in the
 * `vault_settings` table. Keys are sealed with the vault's KEK using the same
 * `sealRecord`/`openRecord` envelope as document blobs — they never leave the
 * local machine except when sent directly to the target API endpoint.
 *
 * Storage format in vault_settings.value_encrypted:
 *   JSON string: { "dek": "<base64 wrappedDEK>", "ct": "<base64 ciphertext>" }
 */

import { sealRecord, openRecord } from './envelope'

const ANTHROPIC_KEY_SETTING = 'anthropic_api_key'

// Cheapest model for key validation — minimises cost of the probe request
const ANTHROPIC_VALIDATE_MODEL = 'claude-haiku-4-20250514'

// ── Storage helpers ──────────────────────────────────────────────────────────

function settingAad(key: string): Buffer {
  return Buffer.from(`vault_setting:${key}`)
}

interface SettingBlob {
  dek: string  // base64 wrappedDEK
  ct: string   // base64 ciphertext
}

/**
 * Save (upsert) the Anthropic API key, encrypted with the vault KEK.
 */
export async function saveAnthropicApiKey(db: any, kek: Buffer, apiKey: string): Promise<void> {
  const aad = settingAad(ANTHROPIC_KEY_SETTING)
  // Store the key as a JSON-encoded string so openRecord's JSON.parse returns it correctly
  const { wrappedDEK, ciphertext } = await sealRecord(JSON.stringify(apiKey), kek, aad)

  const blob: SettingBlob = {
    dek: wrappedDEK.toString('base64'),
    ct: ciphertext.toString('base64'),
  }
  const now = Date.now()
  db.prepare(`
    INSERT INTO vault_settings (key, value_encrypted, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_encrypted = excluded.value_encrypted, updated_at = excluded.updated_at
  `).run(ANTHROPIC_KEY_SETTING, JSON.stringify(blob), now, now)
}

/**
 * Retrieve and decrypt the stored Anthropic API key.
 * Returns null if no key is stored or decryption fails.
 */
export async function getAnthropicApiKeyAsync(db: any, kek: Buffer): Promise<string | null> {
  const row: { value_encrypted: string } | undefined = db
    .prepare('SELECT value_encrypted FROM vault_settings WHERE key = ?')
    .get(ANTHROPIC_KEY_SETTING)
  if (!row) return null

  try {
    const blob: SettingBlob = JSON.parse(row.value_encrypted)
    const wrappedDEK = Buffer.from(blob.dek, 'base64')
    const ciphertext = Buffer.from(blob.ct, 'base64')
    const aad = settingAad(ANTHROPIC_KEY_SETTING)

    // openRecord JSON.parse-s the decrypted payload — we stored JSON.stringify(apiKey)
    // so the result is the plain string
    const decrypted = await openRecord(wrappedDEK, ciphertext, kek, aad)
    if (typeof decrypted === 'string') return decrypted
    return null
  } catch {
    return null
  }
}

/**
 * Check (without decrypting) whether an Anthropic API key row exists.
 */
export function hasAnthropicApiKey(db: any): boolean {
  const row = db
    .prepare('SELECT key FROM vault_settings WHERE key = ?')
    .get(ANTHROPIC_KEY_SETTING)
  return row != null
}

/**
 * Delete the stored Anthropic API key.
 */
export function removeAnthropicApiKey(db: any): void {
  db.prepare('DELETE FROM vault_settings WHERE key = ?').run(ANTHROPIC_KEY_SETTING)
}

// ── Validation ───────────────────────────────────────────────────────────────

export interface ApiKeyValidationResult {
  valid: boolean
  error?: string
}

/**
 * Validate an Anthropic API key with a minimal probe request.
 * Uses the cheapest model with max_tokens=1 to keep cost negligible.
 * 429 (rate limit) and 529 (overloaded) are treated as valid — the key is accepted,
 * the server is just temporarily busy.
 */
export async function validateAnthropicApiKey(apiKey: string): Promise<ApiKeyValidationResult> {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_VALIDATE_MODEL,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    })

    if (response.ok) return { valid: true }

    const status = response.status
    const body = await response.json().catch(() => ({}))
    const apiMsg: string = (body as any)?.error?.message ?? ''

    if (status === 401) return { valid: false, error: 'Invalid API key. Please check and try again.' }
    if (status === 403) return { valid: false, error: `API key does not have permission: ${apiMsg || 'access denied'}` }
    if (status === 429) return { valid: true } // rate-limited but the key is valid
    if (status === 529) return { valid: true } // overloaded but the key is valid

    return { valid: false, error: apiMsg || `Anthropic API returned status ${status}` }
  } catch (err: any) {
    return { valid: false, error: `Could not reach Anthropic API: ${err?.message ?? 'network error'}` }
  }
}

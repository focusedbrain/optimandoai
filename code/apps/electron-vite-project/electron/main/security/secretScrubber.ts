/**
 * Credential scrubbing for logs and IPC payloads — P4.5.14.
 *
 * Fingerprints, replica IDs, tier names, and user profile fields are intentionally
 * not treated as secrets.
 */

export const REDACTED = '[REDACTED]' as const

/** Substrings that indicate credential material in free text. */
export const SECRET_SUBSTRING_PATTERNS = [
  'BEGIN OPENSSH PRIVATE KEY',
  'BEGIN RSA PRIVATE KEY',
  'BEGIN EC PRIVATE KEY',
  'BEGIN DSA PRIVATE KEY',
  'BEGIN PRIVATE KEY',
] as const

/** Object keys whose values are always redacted / rejected. */
export const SECRET_FIELD_NAMES = new Set([
  'privatekey',
  'passphrase',
  'password',
  'access_token',
  'refresh_token',
  'client_secret',
  'pod_auth_secret',
  'seal_key_hex',
  'edge_private_key_hex',
])

const SSH_ED25519_PUBLIC = /ssh-ed25519 [A-Za-z0-9+/=]+/g
const SSH_RSA_PUBLIC = /ssh-rsa [A-Za-z0-9+/=]+/g
const BEARER_JWT = /Bearer eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g
const AUTHORIZATION_HEADER = /Authorization:\s*[^\s].+/gi

export function isSecretFieldName(key: string): boolean {
  return SECRET_FIELD_NAMES.has(key.toLowerCase())
}

function redactString(text: string): string {
  let out = text
  for (const marker of SECRET_SUBSTRING_PATTERNS) {
    out = out.replace(
      new RegExp(`${escapeRegExp(marker)}[\\s\\S]*?END [A-Z ]+KEY`, 'g'),
      REDACTED,
    )
    if (out.includes(marker)) {
      out = out.replaceAll(marker, REDACTED)
    }
  }
  out = out.replace(SSH_ED25519_PUBLIC, REDACTED)
  out = out.replace(SSH_RSA_PUBLIC, REDACTED)
  out = out.replace(BEARER_JWT, `Bearer ${REDACTED}`)
  out = out.replace(AUTHORIZATION_HEADER, `Authorization: ${REDACTED}`)
  return out
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function findSecretPatternsInText(text: string): string[] {
  const hits: string[] = []
  for (const marker of SECRET_SUBSTRING_PATTERNS) {
    if (text.includes(marker)) hits.push(marker)
  }
  if (SSH_ED25519_PUBLIC.test(text)) hits.push('ssh-ed25519 public key material')
  SSH_ED25519_PUBLIC.lastIndex = 0
  if (SSH_RSA_PUBLIC.test(text)) hits.push('ssh-rsa public key material')
  SSH_RSA_PUBLIC.lastIndex = 0
  if (BEARER_JWT.test(text)) hits.push('Bearer JWT')
  BEARER_JWT.lastIndex = 0
  if (AUTHORIZATION_HEADER.test(text)) hits.push('Authorization header')
  AUTHORIZATION_HEADER.lastIndex = 0
  return hits
}

export function assertNoSecretsInText(text: string, context: string): void {
  const hits = findSecretPatternsInText(text)
  if (hits.length > 0) {
    throw new Error(`Credential secret detected in ${context}: ${hits[0]}`)
  }
}

export function scrubForLog(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) return value

  if (typeof value === 'string') {
    return redactString(value)
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value
  }

  if (Buffer.isBuffer(value)) {
    const asText = value.toString('utf8')
    const redacted = redactString(asText)
    return redacted === asText ? value : REDACTED
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack) : undefined,
    }
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) return REDACTED
    seen.add(value)
    return value.map((entry) => scrubForLog(entry, seen))
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return REDACTED
    seen.add(value)
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (isSecretFieldName(key)) {
        out[key] = REDACTED
      } else {
        out[key] = scrubForLog(entry, seen)
      }
    }
    return out
  }

  return redactString(String(value))
}

function walkForSecrets(value: unknown, context: string, path: string, seen: WeakSet<object>): void {
  if (value === null || value === undefined) return

  if (typeof value === 'string') {
    assertNoSecretsInText(value, `${context} at ${path}`)
    return
  }

  if (Buffer.isBuffer(value)) {
    assertNoSecretsInText(value.toString('utf8'), `${context} at ${path}`)
    return
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return
  }

  if (value instanceof Error) {
    assertNoSecretsInText(value.message, `${context} at ${path}`)
    if (value.stack) assertNoSecretsInText(value.stack, `${context} at ${path}`)
    return
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) return
    seen.add(value)
    value.forEach((entry, index) => walkForSecrets(entry, context, `${path}[${index}]`, seen))
    return
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return
    seen.add(value)
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (isSecretFieldName(key)) {
        throw new Error(`Credential secret detected in ${context}: sensitive field "${key}" at ${path}`)
      }
      walkForSecrets(entry, context, `${path}.${key}`, seen)
    }
  }
}

export function assertNoSecretsInValue(value: unknown, context: string): void {
  walkForSecrets(value, context, '$', new WeakSet())
  const json = safeJsonStringify(value)
  if (json) {
    assertNoSecretsInText(json, context)
  }
}

function safeJsonStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

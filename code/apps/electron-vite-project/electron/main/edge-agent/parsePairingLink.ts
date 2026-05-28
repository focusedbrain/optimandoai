/**
 * Convenience pairing URL / QR parse (PR8 step 5).
 */

export interface ParsedPairingLink {
  readonly address: string
  readonly code: string
}

function normalizePairingCode(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (digits.length !== 6) return null
  return digits
}

function buildHttpsAddress(hostPart: string): string | null {
  const trimmed = hostPart.trim().replace(/\/$/, '')
  if (!trimmed) return null
  try {
    const withScheme = trimmed.includes('://') ? trimmed : `https://${trimmed}`
    const url = new URL(withScheme)
    if (url.protocol !== 'https:') return null
    const port = url.port || '8443'
    return `https://${url.hostname}:${port}`
  } catch {
    const [host, port] = trimmed.split(':')
    if (!host) return null
    return `https://${host}:${port ?? '8443'}`
  }
}

/**
 * Accepts `wrdesk-pair://host:8443?code=123456`, HTTPS deep links, or pasted host URLs with code query.
 */
export function parsePairingLink(input: string): ParsedPairingLink | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  try {
    if (trimmed.startsWith('wrdesk-pair://')) {
      const rest = trimmed.slice('wrdesk-pair://'.length)
      const qIdx = rest.indexOf('?')
      const hostPart = qIdx >= 0 ? rest.slice(0, qIdx) : rest
      const query = qIdx >= 0 ? rest.slice(qIdx + 1) : ''
      const params = new URLSearchParams(query)
      const code = normalizePairingCode(params.get('code') ?? '')
      const address = buildHttpsAddress(hostPart)
      if (!code || !address) return null
      return { address, code }
    }

    const withScheme = trimmed.includes('://') ? trimmed : `https://${trimmed}`
    const url = new URL(withScheme)
    const codeRaw =
      url.searchParams.get('code') ??
      url.searchParams.get('pairing_code') ??
      url.searchParams.get('wrdesk_code') ??
      ''
    const code = normalizePairingCode(codeRaw)
    if (!code) return null
    const port = url.port || '8443'
    const address = `https://${url.hostname}:${port}`
    return { address, code }
  } catch {
    return null
  }
}

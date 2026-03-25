/**
 * Mutable snapshot of the latest standard Gmail Connect OAuth proof (for logs + UI diagnostics).
 * No secrets, tokens, or full client ids — fingerprints and labels only.
 */

export type GmailStandardConnectRuntimeProof = {
  flowType: 'standard_connect'
  credentialSource: 'builtin_public' | 'developer_saved'
  resolution: string
  authMode: string
  authorizeClientIdFingerprint: string
  tokenExchangeClientIdFingerprint: string
  oauth_client_id_mismatch_between_authorize_and_token_exchange: boolean
  builtinSourceKind?: string
  builtinSourceLabel?: string
  hasClientSecret: boolean
  hasCodeVerifier: boolean
  redirectUri: string
  tokenExchangeShape: string
  googleTokenHttpStatus: number | null
  googleError: string | null
  googleErrorDescription: string | null
  bundledExpectedFingerprint: string | null
  /** Standard packaged production: env OAuth client vars were not used for winning builtin id */
  packagedStandardConnectEnvIgnored: boolean
  /** ISO timestamp when token step completed or failed */
  completedAt: string
}

let lastStandardConnectProof: GmailStandardConnectRuntimeProof | null = null

export function getLastGmailStandardConnectRuntimeProof(): GmailStandardConnectRuntimeProof | null {
  return lastStandardConnectProof
}

export function setLastGmailStandardConnectRuntimeProof(proof: GmailStandardConnectRuntimeProof): void {
  lastStandardConnectProof = proof
}

export function clearLastGmailStandardConnectRuntimeProof(): void {
  lastStandardConnectProof = null
}

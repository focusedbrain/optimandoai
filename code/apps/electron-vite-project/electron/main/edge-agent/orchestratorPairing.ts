/**
 * Orchestrator-side Agent pairing client (PR4 / PR8).
 */

import { randomBytes, randomUUID } from 'node:crypto'
import { Agent as UndiciAgent } from 'undici'

import { generatePairingKeypair, isValidEd25519PublicKeyHex } from './pairingKeysOrchestrator.js'
import { computePairingFingerprint } from './pairingFingerprint.js'

const pairingTlsAgent = new UndiciAgent({
  connect: {
    rejectUnauthorized: false,
  },
})

export type PairingClientErrorCode =
  | 'unreachable'
  | 'invalid_address'
  | 'invalid_code'
  | 'code_mismatch'
  | 'code_expired'
  | 'code_consumed'
  | 'sub_mismatch'
  | 'fingerprint_mismatch'
  | 'pairing_failed'
  | 'session_not_found'
  | 'not_paired'

export class OrchestratorPairingError extends Error {
  constructor(
    readonly code: PairingClientErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'OrchestratorPairingError'
  }
}

export interface PairInitiateResult {
  readonly sessionId: string
  readonly fingerprint: string
  readonly agentPublicKey: string
  readonly agentNonce: string
  readonly orchestratorPublicKey: string
  readonly orchestratorNonce: string
  readonly orchestratorP2pAuthToken: string
  readonly agentEncryptionPublicKeyB64: string
  readonly p2pEndpoint: string
  readonly agentP2pAuthToken: string
}

export interface PairConfirmResult {
  readonly status: 'awaiting_confirmations' | 'paired'
  readonly fingerprint?: string
}

function normalizePairingAddress(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) throw new OrchestratorPairingError('invalid_address', 'Enter a verification server address.')
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
    const allowHttpLocal =
      url.protocol === 'http:' &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
    if (url.protocol !== 'https:' && !allowHttpLocal) {
      throw new OrchestratorPairingError('invalid_address', 'Address must use HTTPS.')
    }
    const port = url.port || '8443'
    const scheme = url.protocol === 'http:' ? 'http' : 'https'
    return `${scheme}://${url.hostname}:${port}`
  } catch (err) {
    if (err instanceof OrchestratorPairingError) throw err
    throw new OrchestratorPairingError('invalid_address', 'Enter a valid HTTPS address (for example https://vps.example.com:8443).')
  }
}

function normalizeWirePairingCode(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length !== 6) {
    throw new OrchestratorPairingError('invalid_code', 'Enter the six-digit code from your verification server.')
  }
  return digits
}

function pairingBaseUrl(address: string): string {
  return normalizePairingAddress(address).replace(/\/$/, '')
}

async function pairingFetch(
  address: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = `${pairingBaseUrl(address)}${path.startsWith('/') ? path : `/${path}`}`
  try {
    return await fetch(url, {
      ...init,
      // @ts-expect-error undici dispatcher for self-signed pairing TLS
      dispatcher: pairingTlsAgent,
    })
  } catch {
    throw new OrchestratorPairingError(
      'unreachable',
      `Couldn't reach your verification server at ${pairingBaseUrl(address)}. Check that it's installed and running, and that the address and port are correct.`,
    )
  }
}

function mapInitiateError(status: number, body: Record<string, unknown>): never {
  const err = String(body.error ?? '')
  switch (err) {
    case 'code_mismatch':
      throw new OrchestratorPairingError(
        'code_mismatch',
        "That code wasn't accepted. Generate a new code on your verification server and try again.",
      )
    case 'code_expired':
    case 'code_consumed':
      throw new OrchestratorPairingError(
        'code_expired',
        "That code wasn't accepted. Generate a new code on your verification server and try again.",
      )
    case 'sub_mismatch':
      throw new OrchestratorPairingError(
        'sub_mismatch',
        'Your verification server is signed in to a different account. Sign in to the same account on both, then retry.',
      )
    case 'invalid_code':
      throw new OrchestratorPairingError('invalid_code', 'Enter a valid six-digit pairing code.')
    default:
      throw new OrchestratorPairingError(
        'pairing_failed',
        String(body.message ?? `Pairing failed (HTTP ${status}).`),
      )
  }
}

export async function checkPairingReachability(address: string): Promise<void> {
  const res = await pairingFetch(address, '/pair/status?session_id=00000000-0000-0000-0000-000000000000', {
    method: 'GET',
  })
  if (res.status === 404 || res.status === 200 || res.status === 405) return
  if (res.status >= 500) {
    throw new OrchestratorPairingError(
      'unreachable',
      `Couldn't reach your verification server at ${pairingBaseUrl(address)}. Check that it's installed and running, and that the address and port are correct.`,
    )
  }
}

export async function pairInitiate(input: {
  readonly address: string
  readonly pairingCode: string
  readonly orchestratorSub: string
}): Promise<PairInitiateResult> {
  const address = pairingBaseUrl(input.address)
  await checkPairingReachability(address)

  const pairingCode = normalizeWirePairingCode(input.pairingCode)
  const orchestratorKeypair = generatePairingKeypair()
  const orchestratorNonce = randomBytes(16).toString('base64url')
  const orchestratorP2pAuthToken = randomUUID()

  const res = await pairingFetch(address, '/pair/initiate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pairing_code: pairingCode,
      orchestrator_sub: input.orchestratorSub,
      orchestrator_public_key: orchestratorKeypair.publicKeyHex,
      orchestrator_nonce: orchestratorNonce,
    }),
  })

  let body: Record<string, unknown> = {}
  try {
    body = (await res.json()) as Record<string, unknown>
  } catch {
    body = {}
  }

  if (!res.ok) {
    mapInitiateError(res.status, body)
  }

  const sessionId = typeof body.session_id === 'string' ? body.session_id : ''
  const agentPublicKey = typeof body.agent_public_key === 'string' ? body.agent_public_key : ''
  const agentNonce = typeof body.agent_nonce === 'string' ? body.agent_nonce : ''
  const agentFingerprint = typeof body.fingerprint === 'string' ? body.fingerprint : ''
  const agentEncryptionPublicKeyB64 =
    typeof body.agent_encryption_public_key_b64 === 'string'
      ? body.agent_encryption_public_key_b64
      : ''
  const p2pEndpoint = typeof body.p2p_endpoint === 'string' ? body.p2p_endpoint : ''
  const agentP2pAuthToken = typeof body.agent_p2p_auth_token === 'string' ? body.agent_p2p_auth_token : ''

  if (!sessionId || !isValidEd25519PublicKeyHex(agentPublicKey) || !agentNonce) {
    throw new OrchestratorPairingError('pairing_failed', 'Verification server returned an invalid pairing response.')
  }

  const fingerprint = computePairingFingerprint(
    orchestratorKeypair.publicKeyHex,
    agentPublicKey,
    orchestratorNonce,
    agentNonce,
  )

  if (fingerprint !== agentFingerprint) {
    throw new OrchestratorPairingError(
      'fingerprint_mismatch',
      'Fingerprint mismatch — pairing response may have been tampered with.',
    )
  }

  if (!agentEncryptionPublicKeyB64 || !p2pEndpoint || !agentP2pAuthToken) {
    throw new OrchestratorPairingError(
      'pairing_failed',
      'Verification server is not ready for pairing (missing encryption or P2P details). Sign in on the server and try again.',
    )
  }

  return {
    sessionId,
    fingerprint,
    agentPublicKey,
    agentNonce,
    orchestratorPublicKey: orchestratorKeypair.publicKeyHex,
    orchestratorNonce,
    orchestratorP2pAuthToken,
    agentEncryptionPublicKeyB64,
    p2pEndpoint,
    agentP2pAuthToken,
  }
}

export async function pairConfirm(input: {
  readonly address: string
  readonly sessionId: string
  readonly orchestratorP2pAuthToken: string
}): Promise<PairConfirmResult> {
  const address = pairingBaseUrl(input.address)
  const res = await pairingFetch(address, '/pair/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: input.sessionId,
      party: 'orchestrator',
      orchestrator_p2p_auth_token: input.orchestratorP2pAuthToken,
    }),
  })

  let body: Record<string, unknown> = {}
  try {
    body = (await res.json()) as Record<string, unknown>
  } catch {
    body = {}
  }

  if (res.status === 404) {
    throw new OrchestratorPairingError('session_not_found', 'Pairing session expired — start again.')
  }
  if (!res.ok) {
    throw new OrchestratorPairingError(
      'pairing_failed',
      String(body.message ?? `Pairing confirm failed (HTTP ${res.status}).`),
    )
  }

  const status = body.status === 'paired' ? 'paired' : 'awaiting_confirmations'
  return {
    status,
    fingerprint: typeof body.fingerprint === 'string' ? body.fingerprint : undefined,
  }
}

export async function pollPairingUntilPaired(input: {
  readonly address: string
  readonly sessionId: string
  readonly timeoutMs?: number
  readonly intervalMs?: number
}): Promise<void> {
  const deadline = Date.now() + (input.timeoutMs ?? 120_000)
  const intervalMs = input.intervalMs ?? 1_000
  while (Date.now() < deadline) {
    const res = await pairingFetch(
      input.address,
      `/pair/status?session_id=${encodeURIComponent(input.sessionId)}`,
      { method: 'GET' },
    )
    if (res.status === 404) {
      throw new OrchestratorPairingError('session_not_found', 'Pairing session expired — start again.')
    }
    const body = (await res.json()) as Record<string, unknown>
    if (body.status === 'paired' || body.status === 'ready_to_persist') {
      return
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new OrchestratorPairingError(
    'not_paired',
    'Waiting for confirmation on your verification server timed out. Confirm the fingerprint on the server, then try again.',
  )
}

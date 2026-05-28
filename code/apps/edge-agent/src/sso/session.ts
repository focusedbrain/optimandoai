import {
  EDGE_AGENT_OIDC,
  exchangeAuthorizationCode,
  prepareAuthorizationRequest,
  refreshWithKeycloak,
  type OidcTokens,
} from '@repo/sso'

import type { AgentStorage } from '../storage.js'
import { AgentTokenStore } from './tokenStore.js'
import { emitAgentLogEvent } from '../log-stream/emit.js'

export const EDGE_AGENT_REDIRECT_URI = 'http://127.0.0.1:8090/sso-callback'

export interface PendingLogin {
  readonly authorizationUrl: string
  readonly codeVerifier: string
  readonly state: string
  readonly nonce: string
}

const pendingByState = new Map<string, PendingLogin & { createdAt: number }>()

export async function startLogin(): Promise<PendingLogin> {
  const req = await prepareAuthorizationRequest(EDGE_AGENT_OIDC, EDGE_AGENT_REDIRECT_URI)
  pendingByState.set(req.state, { ...req, createdAt: Date.now() })
  return req
}

export function getPendingLogin(state: string): PendingLogin | undefined {
  return pendingByState.get(state)
}

export function clearPendingLogin(state: string): void {
  pendingByState.delete(state)
}

export async function completeLogin(
  storage: AgentStorage,
  params: { code: string; state: string },
): Promise<OidcTokens> {
  const pending = pendingByState.get(params.state)
  if (!pending) {
    throw new Error('Unknown or expired login state')
  }
  clearPendingLogin(params.state)

  const tokens = await exchangeAuthorizationCode(
    EDGE_AGENT_OIDC,
    EDGE_AGENT_REDIRECT_URI,
    params.code,
    pending.codeVerifier,
    pending.nonce,
  )

  await persistTokens(storage, tokens)
  return tokens
}

export async function persistTokens(storage: AgentStorage, tokens: OidcTokens): Promise<void> {
  const claims = parseIdTokenClaims(tokens.id_token)
  const state = await storage.loadState()
  const expiresAt = Date.now() + tokens.expires_in * 1000
  await storage.saveState({
    ...state,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    idToken: tokens.id_token,
    tokenExpiresAt: expiresAt,
    ssoSub: claims.sub,
    ssoEmail: claims.email ?? claims.preferred_username,
  })
  if (tokens.refresh_token) {
    await new AgentTokenStore(storage).saveRefreshToken(tokens.refresh_token)
  }
  emitAgentLogEvent({
    level: 'info',
    source: 'sso',
    event_code: 'sso_signed_in',
    message: 'Agent signed in with SSO.',
    fields: { account_id: claims.sub },
  })
}

export function parseIdTokenClaims(idToken: string): {
  sub: string
  email?: string
  preferred_username?: string
} {
  const payload = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >
  return {
    sub: String(payload.sub),
    email: typeof payload.email === 'string' ? payload.email : undefined,
    preferred_username:
      typeof payload.preferred_username === 'string' ? payload.preferred_username : undefined,
  }
}

export async function ensureFreshAccessToken(storage: AgentStorage): Promise<string | null> {
  const state = await storage.loadState()
  if (!state.accessToken) return null
  const skewMs = 60_000
  if (state.tokenExpiresAt && state.tokenExpiresAt > Date.now() + skewMs) {
    return state.accessToken
  }
  const refresh = state.refreshToken ?? (await new AgentTokenStore(storage).loadRefreshToken())
  if (!refresh) return state.accessToken

  let refreshed: Awaited<ReturnType<typeof refreshWithKeycloak>>
  try {
    refreshed = await refreshWithKeycloak(EDGE_AGENT_OIDC, refresh)
  } catch (err) {
    emitAgentLogEvent({
      level: 'error',
      source: 'sso',
      event_code: 'sso_refresh_failed',
      message: 'SSO token refresh failed.',
      fields: { reason: err instanceof Error ? err.message : String(err) },
    })
    throw err
  }
  await persistTokens(storage, {
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token ?? refresh,
    id_token: refreshed.id_token ?? state.idToken ?? '',
    expires_in: refreshed.expires_in,
    token_type: refreshed.token_type,
    scope: refreshed.scope,
  })
  emitAgentLogEvent({
    level: 'info',
    source: 'sso',
    event_code: 'sso_refresh_succeeded',
    message: 'SSO access token refreshed.',
    fields: {},
  })
  const next = await storage.loadState()
  return next.accessToken ?? null
}

export async function isSignedIn(storage: AgentStorage): Promise<boolean> {
  const state = await storage.loadState()
  return Boolean(state.ssoSub && (state.refreshToken || state.accessToken))
}

/** Test-only reset */
export function clearPendingLoginsForTests(): void {
  pendingByState.clear()
}

/**
 * Structured OAuth failure detail for Gmail connect — propagated to renderer / HTTP API / extension UI.
 */

export type GmailOauthConnectDebugStep = 'token_exchange' | 'token_refresh' | 'gmail_api_call' | 'unknown'

export type GmailOauthConnectDebug = {
  step: GmailOauthConnectDebugStep
  httpStatus: number | null
  googleError: string | null
  googleErrorDescription: string | null
  responseBody: string | null
  raw?: string
}

export function attachOauthDebug(err: Error, detail: GmailOauthConnectDebug): Error {
  ;(err as Error & { oauthDebug?: GmailOauthConnectDebug }).oauthDebug = detail
  return err
}

export function oauthDebugFromUnknown(raw: string): GmailOauthConnectDebug {
  return {
    step: 'unknown',
    httpStatus: null,
    googleError: null,
    googleErrorDescription: null,
    responseBody: null,
    raw: raw.substring(0, 500),
  }
}

export function pickOauthDebugFromError(err: unknown): GmailOauthConnectDebug {
  const e = err as Error & { oauthDebug?: GmailOauthConnectDebug }
  const d = e?.oauthDebug
  if (d && typeof d === 'object') {
    return {
      step: (d.step as GmailOauthConnectDebugStep) ?? 'unknown',
      httpStatus: d.httpStatus ?? null,
      googleError: d.googleError ?? null,
      googleErrorDescription: d.googleErrorDescription ?? null,
      responseBody: d.responseBody ?? null,
      ...(d.raw != null ? { raw: String(d.raw).substring(0, 500) } : {}),
    }
  }
  return oauthDebugFromUnknown(((err as Error)?.message != null ? (err as Error).message : String(err)) ?? '')
}

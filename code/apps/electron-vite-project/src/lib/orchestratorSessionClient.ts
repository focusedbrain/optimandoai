/**
 * Orchestrator session JSON via the same HTTP GET as WR Chat / optimization (localhost:51248).
 */

export type OrchestratorSessionJson = Record<string, unknown>

export type FetchOrchestratorSessionResult =
  | { ok: true; data: OrchestratorSessionJson }
  | { ok: false; message: string }

export async function fetchOrchestratorSession(sessionKey: string): Promise<FetchOrchestratorSessionResult> {
  const { defaultDashboardLlmHeaders } = await import('./optimizationLlmAdapter')
  const headers = await defaultDashboardLlmHeaders()
  try {
    const r = await fetch(
      `http://127.0.0.1:51248/api/orchestrator/get?key=${encodeURIComponent(sessionKey)}`,
      { headers },
    )
    if (!r.ok) {
      return {
        ok: false,
        message: `Orchestrator GET failed (${r.status} ${r.statusText}) for session key "${sessionKey}"`,
      }
    }
    const body = (await r.json()) as {
      success?: boolean
      data?: OrchestratorSessionJson
      error?: string
    }
    if (body.success === false) {
      return {
        ok: false,
        message: `Orchestrator GET rejected for "${sessionKey}": ${body.error ?? 'unknown error'}`,
      }
    }
    const data = body?.data ?? null
    if (!data) {
      return {
        ok: false,
        message: `Orchestrator returned no session data for key "${sessionKey}"`,
      }
    }
    return { ok: true, data }
  } catch (e) {
    const hint = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      message: `Orchestrator GET network error for key "${sessionKey}": ${hint}`,
    }
  }
}

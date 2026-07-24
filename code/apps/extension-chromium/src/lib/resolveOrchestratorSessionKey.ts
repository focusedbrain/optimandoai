/**
 * Canonical orchestrator session key for Global Session Context save/read parity.
 * Stage 1: key normalization only — no LLM injection.
 */

export const ORCHESTRATOR_ACTIVE_SESSION_STORAGE_KEY = 'optimando-active-session-key'
export const ORCHESTRATOR_GLOBAL_ACTIVE_SESSION_KEY = 'optimando-global-active-session'
export const ORCHESTRATOR_TAB_SESSION_STORAGE_KEY = 'optimando-current-session-key'
/** Mirrored by sidepanel when a persisted custom mode is active. */
export const ORCHESTRATOR_ACTIVE_MODE_SESSION_ID_KEY = 'optimando-active-mode-session-id'
export const ORCHESTRATOR_ACTIVE_MODE_ID_KEY = 'optimando-active-mode-id'
export const GLOBAL_ACCOUNT_CONTEXT_KEY = 'optimando_account_context'

const USER_CONTEXT_PREFIX = 'user_context_'
const PUBLISHER_CONTEXT_PREFIX = 'publisher_context_'

export type ResolveOrchestratorSessionKeyContext = {
  /** Mode-linked session id (only honored when modeIsActive). */
  modeSessionId?: string | null
  /** When false, modeSessionId is ignored even if set. */
  modeIsActive?: boolean
  /** Sidepanel / WR Chat orchestrator session state. */
  sidepanelSessionKey?: string | null
  /** Mode-run / BEAP explicit override. */
  explicitSessionKey?: string | null
}

export type OrchestratorSessionHintsFromStorage = {
  sidepanelSessionKey: string | null
  activeModeSessionId: string | null
  activeModeId: string | null
}

/** Accept orchestrator session ids only — rejects bare tab ids and sentinels. */
export function normalizeOrchestratorSessionKey(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const trimmed = String(raw).trim()
  if (!trimmed || trimmed === 'session_fallback') return null
  if (trimmed.startsWith('session_') || trimmed.startsWith('archive_session_')) return trimmed
  return null
}

export function globalSessionContextStorageKeys(sessionKey: string): {
  userContextKey: string
  publisherContextKey: string
  accountContextKey: typeof GLOBAL_ACCOUNT_CONTEXT_KEY
} {
  return {
    userContextKey: `${USER_CONTEXT_PREFIX}${sessionKey}`,
    publisherContextKey: `${PUBLISHER_CONTEXT_PREFIX}${sessionKey}`,
    accountContextKey: GLOBAL_ACCOUNT_CONTEXT_KEY,
  }
}

export function logGlobalContextSessionKey(
  phase: 'save' | 'read',
  key: string | null,
  source: string,
): void {
  console.log(`[GLOBAL_CONTEXT] ${phase} key=${key ?? 'null'} source=${source}`)
}

/**
 * Sync resolver — priority:
 * 1) active mode sessionId (when modeIsActive)
 * 2) sidepanel orchestrator session key
 * 3) explicit caller session key
 */
export function resolveOrchestratorSessionKeyForInference(
  ctx: ResolveOrchestratorSessionKeyContext = {},
): string | null {
  const modeActive = ctx.modeIsActive !== false
  if (modeActive) {
    const fromMode = normalizeOrchestratorSessionKey(ctx.modeSessionId)
    if (fromMode) return fromMode
  }

  const fromSidepanel = normalizeOrchestratorSessionKey(ctx.sidepanelSessionKey)
  if (fromSidepanel) return fromSidepanel

  const fromExplicit = normalizeOrchestratorSessionKey(ctx.explicitSessionKey)
  if (fromExplicit) return fromExplicit

  return null
}

export function readActiveSessionKeyFromChromeStorage(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      chrome.storage?.local?.get([ORCHESTRATOR_ACTIVE_SESSION_STORAGE_KEY], (data: Record<string, unknown>) => {
        const sessionKey = data?.[ORCHESTRATOR_ACTIVE_SESSION_STORAGE_KEY]
        resolve(typeof sessionKey === 'string' ? sessionKey : null)
      })
    } catch {
      resolve(null)
    }
  })
}

export function readOrchestratorSessionHintsFromChromeStorage(): Promise<OrchestratorSessionHintsFromStorage> {
  return new Promise((resolve) => {
    try {
      chrome.storage?.local?.get(
        [
          ORCHESTRATOR_ACTIVE_SESSION_STORAGE_KEY,
          ORCHESTRATOR_ACTIVE_MODE_SESSION_ID_KEY,
          ORCHESTRATOR_ACTIVE_MODE_ID_KEY,
        ],
        (data: Record<string, unknown>) => {
          resolve({
            sidepanelSessionKey:
              typeof data?.[ORCHESTRATOR_ACTIVE_SESSION_STORAGE_KEY] === 'string'
                ? data[ORCHESTRATOR_ACTIVE_SESSION_STORAGE_KEY]
                : null,
            activeModeSessionId:
              typeof data?.[ORCHESTRATOR_ACTIVE_MODE_SESSION_ID_KEY] === 'string'
                ? data[ORCHESTRATOR_ACTIVE_MODE_SESSION_ID_KEY]
                : null,
            activeModeId:
              typeof data?.[ORCHESTRATOR_ACTIVE_MODE_ID_KEY] === 'string'
                ? data[ORCHESTRATOR_ACTIVE_MODE_ID_KEY]
                : null,
          })
        },
      )
    } catch {
      resolve({ sidepanelSessionKey: null, activeModeSessionId: null, activeModeId: null })
    }
  })
}

/** Async resolver — adds chrome.storage optimando-active-session-key as final fallback. */
export async function resolveOrchestratorSessionKeyForInferenceAsync(
  ctx: ResolveOrchestratorSessionKeyContext = {},
): Promise<string | null> {
  const sync = resolveOrchestratorSessionKeyForInference(ctx)
  if (sync) return sync
  const fromChrome = await readActiveSessionKeyFromChromeStorage()
  return normalizeOrchestratorSessionKey(fromChrome)
}

/** Build inference resolver context from an active custom mode runtime (sidepanel / popup). */
export function inferenceSessionKeyContextFromMode(
  modeRuntime: { sessionId: string | null } | null | undefined,
  sidepanelSessionKey: string | null | undefined,
  explicitSessionKey?: string | null,
): ResolveOrchestratorSessionKeyContext {
  return {
    modeSessionId: modeRuntime?.sessionId ?? null,
    modeIsActive: !!modeRuntime,
    sidepanelSessionKey: sidepanelSessionKey ?? null,
    explicitSessionKey: explicitSessionKey ?? null,
  }
}

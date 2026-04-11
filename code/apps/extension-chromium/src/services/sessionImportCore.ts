/**
 * Canonical session import / restore (file, future BEAP, programmatic).
 *
 * - Normalizes export v1.0.0 and legacy raw blobs into a working-copy session object.
 * - Always persists under a new `session_${Date.now()}` key unless `sessionKey` is supplied.
 * - Activation (merge into live tab, notify sidepanel, optional windows) is explicit and never runs agents.
 *
 * Normal WR Chat / orchestration execution stays separate — callers use `activation: 'none'` until they
 * explicitly choose `activate_full` or `activate_minimal`.
 */

import { sessionDisplayLabel } from '../utils/sessionDisplayLabel'

export type SessionImportActivationIntent =
  /** Persist working copy only (same as legacy “Load later”). */
  | 'none'
  /** Full legacy `loadImportedSession`: helpers, hybrid tabs, display grids. */
  | 'activate_full'
  /** Same as full except no helper / hybrid / grid popups — oriented toward in-page edit. */
  | 'activate_minimal'

/**
 * Product hint for future BEAP Inbox / UI; does not alter storage layout.
 */
export type SessionImportIntentHint = 'standard' | 'prepare_edit' | 'prepare_run_later'

export type SessionImportActivationProfile = 'full' | 'minimal'

export interface NormalizedSessionImport {
  sessionData: Record<string, unknown>
  isExportFormat: boolean
}

export interface SessionDataNotification {
  sessionName: string
  sessionKey: string
  isLocked: boolean
  agentBoxes: unknown[]
}

/**
 * Host hooks for tab/session side effects (implemented in content-script where globals live).
 */
export interface SessionImportActivationHost {
  restoreAgentConfigs: (agents: unknown[]) => void
  restoreMemoryData: (memory: unknown, sessionData: Record<string, unknown>) => void
  restoreContextData: (context: unknown, sessionData: Record<string, unknown>) => void
  /** Merge cleaned session fields into live `currentTabData`; preserve current tab id; set isLocked. */
  mergeImportedIntoCurrentTab: (sessionData: Record<string, unknown>) => void
  setCurrentSessionKey: (sessionKey: string) => void
  saveTabDataToStorage: () => void
  renderAgentBoxes: () => void
  getAgentBoxesForNotify: () => unknown[]
  getSessionNameForNotify: () => string
  getIsLockedForNotify: () => boolean
  notifyUpdateAgentBoxes: (boxes: unknown[]) => void
  notifyUpdateSessionData: (payload: SessionDataNotification) => void
  /** Returns human-readable warnings (e.g. popup blocked). May be async for delayed opens. */
  openImportHelperTabs?: (urls: string[], sessionKey: string) => string[] | Promise<string[]>
  openImportHybridViews?: (
    hybridTabs: unknown[],
    sessionData: Record<string, unknown>,
    sessionKey: string,
  ) => string[] | Promise<string[]>
  openImportDisplayGrids?: (grids: unknown[], sessionKey: string) => string[] | Promise<string[]>
  showImportActivatedNotification?: () => void
}

export interface CanonicalSessionImportOptions {
  importData: unknown
  /** Defaults to `session_${Date.now()}`. */
  sessionKey?: string
  pageUrlFallback?: string
  /**
   * After persist: whether to merge into the active tab and notify.
   * Use `none` for import-only or “run later” working copies.
   */
  activation: SessionImportActivationIntent
  /** Optional hint for future callers (BEAP). */
  intent?: SessionImportIntentHint
  storageSet: (items: Record<string, unknown>, callback?: () => void) => void | Promise<void>
  /** Required when `activation` is not `none`. */
  host?: SessionImportActivationHost
}

export interface CanonicalSessionImportResult {
  ok: true
  sessionKey: string
  /** Shape written to storage (may still include `_importedMemory` / `_importedContext`). */
  sessionData: Record<string, unknown>
  isExportFormat: boolean
  displayName: string
  activation: SessionImportActivationIntent
  intent: SessionImportIntentHint
  activated: boolean
  warnings: string[]
}

export function createNewImportSessionKey(): string {
  return `session_${Date.now()}`
}

/**
 * Validate and map file/API payload → session blob (before persist).
 */
/**
 * Try to normalize import data without throwing (for validators / BEAP inbox).
 */
export function safeNormalizeImportedSessionPayload(
  importData: unknown,
  options?: { pageUrl?: string },
): { ok: true; normalized: NormalizedSessionImport } | { ok: false; error: string } {
  try {
    return { ok: true, normalized: normalizeImportedSessionPayload(importData, options) }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
}

export function normalizeImportedSessionPayload(
  importData: unknown,
  options?: { pageUrl?: string },
): NormalizedSessionImport {
  if (!importData || typeof importData !== 'object') {
    throw new Error('Invalid import data: not an object')
  }

  const raw = importData as Record<string, unknown>
  const isExportFormat = raw.version === '1.0.0'
  const pageUrl = options?.pageUrl ?? (typeof window !== 'undefined' ? window.location.href : '')

  let sessionData: Record<string, unknown>

  if (isExportFormat) {
    const uiState = (raw.uiState as Record<string, unknown> | undefined) ?? {}

    sessionData = {
      tabId: raw.tabId,
      tabName: (raw.tabName as string) || (raw.sessionName as string) || 'Imported Session',
      sessionAlias: raw.sessionAlias ?? null,
      timestamp: (raw.timestamp as string) || new Date().toISOString(),
      url: (raw.url as string) || pageUrl,
      isLocked: true,

      goals: raw.goals || { shortTerm: '', midTerm: '', longTerm: '' },
      userIntentDetection: raw.userIntentDetection || null,
      uiConfig: raw.uiConfig || { leftSidebarWidth: 350, rightSidebarWidth: 450, bottomSidebarHeight: 45 },
      helperTabs: raw.helperTabs || null,
      displayGrids: raw.displayGrids || null,

      agentBoxes: raw.agentBoxes || [],
      agents: raw.agents || [],
      agentBoxHeights: uiState.agentBoxHeights || {},

      customAgentLayout: uiState.customAgentLayout || null,
      customAgentOrder: uiState.customAgentOrder || null,
      displayGridActiveTab: uiState.displayGridActiveTab || null,
      hybridViews: uiState.hybridViews || [],

      customAgents: raw.customAgents || [],
      hiddenBuiltins: raw.hiddenBuiltins || [],
      numberMap: raw.numberMap || {},
      nextNumber: raw.nextNumber || 1,
    }

    sessionData._importedMemory = raw.memory || null
    sessionData._importedContext = raw.context || null
  } else {
    sessionData = {
      ...raw,
      isLocked: true,
      timestamp: (raw.timestamp as string) || new Date().toISOString(),
    }
  }

  return { sessionData, isExportFormat }
}

export function persistImportedSessionRecord(
  storageSet: (items: Record<string, unknown>, callback?: () => void) => void | Promise<void>,
  sessionKey: string,
  sessionData: Record<string, unknown>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    void (async () => {
      try {
        await storageSet({ [sessionKey]: sessionData }, () => resolve())
      } catch (e) {
        reject(e)
      }
    })()
  })
}

/**
 * Merge imported session into live tab (legacy `loadImportedSession` body), optional popups by profile.
 * Does not persist again — caller already wrote `sessionKey`.
 */
export async function activateImportedSession(
  host: SessionImportActivationHost,
  sessionKey: string,
  sessionData: Record<string, unknown>,
  profile: SessionImportActivationProfile,
): Promise<{ warnings: string[] }> {
  const warnings: string[] = []
  const work = JSON.parse(JSON.stringify(sessionData)) as Record<string, unknown>

  const agents = work.agents as unknown[] | undefined
  if (agents && agents.length > 0) {
    host.restoreAgentConfigs(agents)
  }

  if (work._importedMemory) {
    host.restoreMemoryData(work._importedMemory, work)
  }
  if (work._importedContext) {
    host.restoreContextData(work._importedContext, work)
  }

  delete work._importedMemory
  delete work._importedContext

  host.mergeImportedIntoCurrentTab(work)
  host.setCurrentSessionKey(sessionKey)
  host.saveTabDataToStorage()

  const boxes = work.agentBoxes as unknown[] | undefined
  if (boxes && boxes.length > 0) {
    host.renderAgentBoxes()
    const notifyBoxes = host.getAgentBoxesForNotify()
    host.notifyUpdateAgentBoxes(notifyBoxes)
    host.notifyUpdateSessionData({
      sessionName: host.getSessionNameForNotify(),
      sessionKey,
      isLocked: host.getIsLockedForNotify(),
      agentBoxes: notifyBoxes,
    })
  }

  if (profile === 'full') {
    const helper = work.helperTabs as { urls?: string[] } | null | undefined
    if (helper?.urls && helper.urls.length > 0 && host.openImportHelperTabs) {
      warnings.push(...(await Promise.resolve(host.openImportHelperTabs(helper.urls, sessionKey))))
    }

    const hybridTabs = (work.hybridViews || work.hybridAgentBoxes || []) as unknown[]
    if (hybridTabs.length > 0 && host.openImportHybridViews) {
      warnings.push(
        ...(await Promise.resolve(host.openImportHybridViews(hybridTabs, work, sessionKey))),
      )
    }

    const grids = work.displayGrids as unknown[] | undefined
    if (grids && grids.length > 0 && host.openImportDisplayGrids) {
      warnings.push(...(await Promise.resolve(host.openImportDisplayGrids(grids, sessionKey))))
    }
  }

  host.showImportActivatedNotification?.()
  return { warnings }
}

/**
 * Full pipeline: normalize → persist → optional activate.
 */
export async function runCanonicalSessionImport(
  options: CanonicalSessionImportOptions,
): Promise<CanonicalSessionImportResult> {
  const intent: SessionImportIntentHint = options.intent ?? 'standard'
  const sessionKey = options.sessionKey ?? createNewImportSessionKey()
  const { sessionData, isExportFormat } = normalizeImportedSessionPayload(options.importData, {
    pageUrl: options.pageUrlFallback,
  })

  await persistImportedSessionRecord(options.storageSet, sessionKey, sessionData)

  const displayName = sessionDisplayLabel(sessionData as Parameters<typeof sessionDisplayLabel>[0], sessionKey)
  const warnings: string[] = []
  let activated = false

  if (options.activation === 'activate_full' || options.activation === 'activate_minimal') {
    if (!options.host) {
      throw new Error('Session import activation requires `host` when activation is not none')
    }
    const profile: SessionImportActivationProfile =
      options.activation === 'activate_full' ? 'full' : 'minimal'
    const ar = await activateImportedSession(options.host, sessionKey, sessionData, profile)
    warnings.push(...ar.warnings)
    activated = true
  }

  return {
    ok: true,
    sessionKey,
    sessionData,
    isExportFormat,
    displayName,
    activation: options.activation,
    intent,
    activated,
    warnings,
  }
}

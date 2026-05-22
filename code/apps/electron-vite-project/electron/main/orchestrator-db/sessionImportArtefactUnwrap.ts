/**
 * Electron-side mirror of extension sessionImportArtefactUnwrap (no cross-package import at runtime).
 */

export type SessionImportUnwrapResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; reason: string }

function isSessionImportArtefactWrapper(obj: Record<string, unknown>): boolean {
  return obj.schema_version === '1.0.0' && Array.isArray(obj.sessions)
}

function isOrchestratorSessionContent(obj: Record<string, unknown>): boolean {
  if (obj.session_kind === 'orchestrator_session') return true
  if (typeof obj.session_id === 'string') {
    return (
      Array.isArray(obj.agents) ||
      Array.isArray(obj.agent_boxes) ||
      Array.isArray(obj.agentBoxes) ||
      Array.isArray(obj.display_grids) ||
      Array.isArray(obj.displayGrids)
    )
  }
  return false
}

function orchestratorSessionContentToTabImport(raw: Record<string, unknown>): Record<string, unknown> {
  const sessionName =
    typeof raw.session_name === 'string'
      ? raw.session_name
      : typeof raw.sessionName === 'string'
        ? raw.sessionName
        : typeof raw.tabName === 'string'
          ? raw.tabName
          : 'Imported Session'

  return {
    tabName: sessionName,
    sessionAlias: raw.sessionAlias ?? null,
    agents: Array.isArray(raw.agents) ? raw.agents : [],
    agentBoxes: Array.isArray(raw.agentBoxes)
      ? raw.agentBoxes
      : Array.isArray(raw.agent_boxes)
        ? raw.agent_boxes
        : [],
    displayGrids: Array.isArray(raw.displayGrids)
      ? raw.displayGrids
      : Array.isArray(raw.display_grids)
        ? raw.display_grids
        : [],
    helperTabs: raw.helperTabs ?? raw.helper_tabs ?? null,
    hybridViews: raw.hybridViews ?? raw.hybrid_views ?? raw.hybridAgentBoxes ?? [],
    goals: raw.goals ?? { shortTerm: '', midTerm: '', longTerm: '' },
    uiConfig: raw.uiConfig ?? {
      leftSidebarWidth: 350,
      rightSidebarWidth: 450,
      bottomSidebarHeight: 45,
    },
    url: typeof raw.url === 'string' ? raw.url : '',
    isLocked: true,
    timestamp: typeof raw.timestamp === 'string' ? raw.timestamp : new Date().toISOString(),
    customAgents: raw.customAgents ?? [],
    hiddenBuiltins: raw.hiddenBuiltins ?? [],
    numberMap: raw.numberMap ?? {},
    nextNumber: raw.nextNumber ?? 1,
    lastOpenedAt: new Date().toISOString(),
  }
}

export function unwrapSessionImportPayloadForTab(importData: unknown): SessionImportUnwrapResult {
  if (importData === null || importData === undefined) {
    return { ok: false, reason: 'Import payload is missing.' }
  }
  if (typeof importData !== 'object' || Array.isArray(importData)) {
    return { ok: false, reason: 'Import payload must be a session object, not an array or primitive.' }
  }

  let raw = importData as Record<string, unknown>

  if (isSessionImportArtefactWrapper(raw)) {
    const sessions = raw.sessions as unknown[]
    if (
      !sessions.length ||
      typeof sessions[0] !== 'object' ||
      sessions[0] === null ||
      Array.isArray(sessions[0])
    ) {
      return { ok: false, reason: 'Session import artefact has no importable session.' }
    }
    raw = sessions[0] as Record<string, unknown>
  }

  if (isOrchestratorSessionContent(raw)) {
    return { ok: true, payload: orchestratorSessionContentToTabImport(raw) }
  }

  return { ok: true, payload: raw }
}

export function newBeapImportSessionKey(): string {
  return `session_${Date.now()}`
}

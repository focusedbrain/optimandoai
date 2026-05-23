/**
 * Unwrap SessionImportArtefact wrappers and map session content (snake_case)
 * into tab-import shape (camelCase) expected by sessionImportCore activation.
 *
 * Supports both schema versions:
 *   v1.0.0 — sessions[0] is OrchestratorSessionContent → mapped via orchestratorSessionContentToTabImport
 *   v1.1.0 — sessions[0] may be FullSessionExportContent → session_export blob returned directly
 *             (caller or normalizeImportedSessionPayload handles the blob)
 */

export type SessionImportUnwrapResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; reason: string }

export function isSessionImportArtefactWrapper(obj: Record<string, unknown>): boolean {
  return (obj.schema_version === '1.0.0' || obj.schema_version === '1.1.0') && Array.isArray(obj.sessions)
}

export function isOrchestratorSessionContent(obj: Record<string, unknown>): boolean {
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

export function isFullSessionExportContent(obj: Record<string, unknown>): boolean {
  return obj.session_kind === 'full_session_export'
}

export function orchestratorSessionContentToTabImport(
  raw: Record<string, unknown>,
  pageUrl?: string,
): Record<string, unknown> {
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
    url: typeof raw.url === 'string' ? raw.url : pageUrl ?? '',
    isLocked: true,
    timestamp: typeof raw.timestamp === 'string' ? raw.timestamp : new Date().toISOString(),
    customAgents: raw.customAgents ?? [],
    hiddenBuiltins: raw.hiddenBuiltins ?? [],
    numberMap: raw.numberMap ?? {},
    nextNumber: raw.nextNumber ?? 1,
  }
}

export function unwrapSessionImportPayloadForTab(
  importData: unknown,
  options?: { pageUrl?: string },
): SessionImportUnwrapResult {
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

  // v1.1.0 path: full session blob — return session_export directly so downstream
  // normalizeImportedSessionPayload receives the complete KV object unchanged.
  if (isFullSessionExportContent(raw)) {
    const blob = raw.session_export
    if (typeof blob !== 'object' || blob === null || Array.isArray(blob)) {
      return { ok: false, reason: 'full_session_export: session_export must be a non-null object.' }
    }
    return { ok: true, payload: blob as Record<string, unknown> }
  }

  if (isOrchestratorSessionContent(raw)) {
    return { ok: true, payload: orchestratorSessionContentToTabImport(raw, options?.pageUrl) }
  }

  return { ok: true, payload: raw }
}

/**
 * WR Desk™ — Single entry guard for auto-optimization triggers.
 */

import { useProjectStore } from '../stores/useProjectStore'
import type { Project } from '../types/projectTypes'
import type { GuardFallback, GuardResult, TriggerSource } from '../types/optimizationTypes'
import { WRDESK_OPTIMIZATION_GUARD_TOAST } from './wrdeskUiEvents'

function hasLinkedSession(linkedSessionIds: string[] | undefined): boolean {
  const ids = linkedSessionIds ?? []
  return ids.some((s) => typeof s === 'string' && s.trim().length > 0)
}

/**
 * Resolves the project for this guard pass.
 * - If `explicitProjectId` is set, loads that project (dashboard may use a different active id).
 * - Otherwise uses `activeProjectId` from the store.
 */
function resolveProject(explicitProjectId?: string | null): {
  project: Project | null
  fail: GuardResult | null
} {
  const state = useProjectStore.getState()
  if (explicitProjectId != null && explicitProjectId !== '') {
    const p = state.projects.find((x) => x.id === explicitProjectId) ?? null
    if (!p) {
      return {
        project: null,
        fail: {
          ok: false,
          code: 'PROJECT_MISSING',
          message: 'Project not found.',
          fallback: 'clear_selection',
        },
      }
    }
    return { project: p, fail: null }
  }

  const aid = state.activeProjectId
  if (aid == null || aid === '') {
    return {
      project: null,
      fail: {
        ok: false,
        code: 'NO_PROJECT',
        message: 'Select a project first.',
        fallback: 'focus_project_selector',
      },
    }
  }

  const p = state.projects.find((x) => x.id === aid) ?? null
  if (!p) {
    return {
      project: null,
      fail: {
        ok: false,
        code: 'PROJECT_MISSING',
        message: 'Project not found.',
        fallback: 'clear_selection',
      },
    }
  }
  return { project: p, fail: null }
}

/**
 * Single guard for all auto-optimization entry points.
 *
 * @param explicitProjectId — When set (e.g. extension HTTP by URL id), evaluates that project instead of the active project.
 */
export function canRunOptimization(
  trigger: TriggerSource,
  explicitProjectId?: string | null,
): GuardResult {
  const { project: P, fail } = resolveProject(explicitProjectId)
  if (fail) return fail
  if (!P) {
    return {
      ok: false,
      code: 'PROJECT_MISSING',
      message: 'Project not found.',
      fallback: 'clear_selection',
    }
  }

  if (!P.autoOptimizationEnabled) {
    if (trigger === 'dashboard_interval' || trigger === 'extension_continuous') {
      return {
        ok: false,
        code: 'AUTO_OPT_OFF',
        message: 'Auto-optimization is off.',
        fallback: 'stop_interval',
      }
    }
    if (trigger === 'dashboard_snapshot' || trigger === 'extension_snapshot') {
      if (!hasLinkedSession(P.linkedSessionIds)) {
        return {
          ok: false,
          code: 'NO_SESSION',
          message: 'Link a WR Chat session for this project.',
          fallback: 'open_session_picker',
        }
      }
      return { ok: true, mode: 'SNAPSHOT_ONLY' }
    }
    if (trigger === 'dashboard_toggle') {
      if (!hasLinkedSession(P.linkedSessionIds)) {
        return {
          ok: false,
          code: 'NO_SESSION',
          message: 'Link a WR Chat session for this project.',
          fallback: 'open_session_picker',
        }
      }
      return { ok: true, mode: 'RUN' }
    }
  }

  if (!hasLinkedSession(P.linkedSessionIds)) {
    return {
      ok: false,
      code: 'NO_SESSION',
      message: 'Link a WR Chat session for this project.',
      fallback: 'open_session_picker',
    }
  }

  return { ok: true, mode: 'RUN' }
}

/** Side effects for failed guards (renderer). Idempotent where possible. */
export function applyOptimizationGuardFallback(
  fallback: GuardFallback,
  message: string,
): void {
  switch (fallback) {
    case 'focus_project_selector':
      try {
        window.dispatchEvent(
          new CustomEvent(WRDESK_OPTIMIZATION_GUARD_TOAST, {
            detail: { message, variant: 'info' as const },
          }),
        )
      } catch {
        /* noop */
      }
      break
    case 'clear_selection':
      try {
        useProjectStore.getState().setActiveProject(null)
      } catch {
        /* noop */
      }
      try {
        window.dispatchEvent(
          new CustomEvent(WRDESK_OPTIMIZATION_GUARD_TOAST, {
            detail: { message, variant: 'warning' as const },
          }),
        )
      } catch {
        /* noop */
      }
      break
    case 'stop_interval':
      void import('./autoOptimizationEngine').then((m) => {
        m.stopAutoOptimization()
      })
      try {
        window.dispatchEvent(
          new CustomEvent(WRDESK_OPTIMIZATION_GUARD_TOAST, {
            detail: { message, variant: 'info' as const },
          }),
        )
      } catch {
        /* noop */
      }
      break
    case 'show_hint':
      try {
        window.dispatchEvent(
          new CustomEvent(WRDESK_OPTIMIZATION_GUARD_TOAST, {
            detail: { message, variant: 'info' as const },
          }),
        )
      } catch {
        /* noop */
      }
      break
    case 'open_session_picker':
      try {
        window.dispatchEvent(
          new CustomEvent(WRDESK_OPTIMIZATION_GUARD_TOAST, {
            detail: { message, variant: 'warning' as const },
          }),
        )
      } catch {
        /* noop */
      }
      break
    case 'noop':
    default:
      break
  }
}

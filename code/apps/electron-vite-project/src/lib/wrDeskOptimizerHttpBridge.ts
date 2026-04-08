/**
 * Exposes `window.__wrdeskOptimizerHttp` for the Electron main HTTP server
 * (`/api/projects/:id/optimize/*`) via `executeJavaScript`.
 */
import { useProjectStore } from '../stores/useProjectStore'
import type { GuardFailCode } from '../types/optimizationTypes'
import {
  canRunOptimization,
} from './autoOptimizationGuards'
import {
  startAutoOptimization,
  stopAutoOptimization,
  triggerSnapshotOptimization,
} from './autoOptimizationEngine'

type BridgeOkSnapshot = { ok: true }
type BridgeFail = {
  ok: false
  error: string
  code?: GuardFailCode
  message?: string
}

type BridgeApi = {
  snapshot: (projectId: string) => Promise<BridgeOkSnapshot | BridgeFail>
  setContinuous: (
    projectId: string,
    enabled: boolean,
  ) => Promise<
    | { ok: true; enabled?: boolean; intervalMs?: number; lastRunAt?: number | null }
    | BridgeFail
  >
  getStatus: (
    projectId: string,
  ) => Promise<{ ok: boolean; enabled?: boolean; intervalMs?: number; lastRunAt?: number | null; error?: string }>
}

function hasLinkedSessionIds(project: { linkedSessionIds?: string[] }): boolean {
  const ids = project.linkedSessionIds ?? []
  return ids.some((s) => typeof s === 'string' && s.trim().length > 0)
}

export function registerWrDeskOptimizerHttpBridge(): void {
  const api: BridgeApi = {
    async snapshot(projectId) {
      const guard = canRunOptimization('extension_snapshot', projectId)
      if (!guard.ok) {
        return {
          ok: false,
          error: guard.message,
          code: guard.code,
          message: guard.message,
        }
      }
      const p = useProjectStore.getState().projects.find((x) => x.id === projectId)
      if (!p) {
        return {
          ok: false,
          error: 'project not found',
          code: 'PROJECT_MISSING',
          message: 'Project not found.',
        }
      }
      triggerSnapshotOptimization(p, 'extension_snapshot')
      return { ok: true }
    },
    async setContinuous(projectId, enabled) {
      const store = useProjectStore.getState()
      const p0 = store.projects.find((x) => x.id === projectId)
      if (!p0) {
        return {
          ok: false,
          error: 'project not found',
          code: 'PROJECT_MISSING',
          message: 'Project not found.',
        }
      }

      if (!enabled) {
        store.setAutoOptimization(projectId, false)
        stopAutoOptimization()
        const p = useProjectStore.getState().projects.find((x) => x.id === projectId)
        if (!p) {
          return {
            ok: false,
            error: 'project not found',
            code: 'PROJECT_MISSING',
            message: 'Project not found.',
          }
        }
        return {
          ok: true,
          enabled: p.autoOptimizationEnabled,
          intervalMs: p.autoOptimizationIntervalMs,
        }
      }

      if (!hasLinkedSessionIds(p0)) {
        return {
          ok: false,
          error: 'Link a WR Chat session for this project.',
          code: 'NO_SESSION',
          message: 'Link a WR Chat session for this project.',
        }
      }

      store.setAutoOptimization(projectId, true)
      const p1 = useProjectStore.getState().projects.find((x) => x.id === projectId)
      if (!p1) {
        return {
          ok: false,
          error: 'project not found',
          code: 'PROJECT_MISSING',
          message: 'Project not found.',
        }
      }

      const guard = canRunOptimization('extension_continuous', projectId)
      if (!guard.ok) {
        store.setAutoOptimization(projectId, false)
        return {
          ok: false,
          error: guard.message,
          code: guard.code,
          message: guard.message,
        }
      }

      startAutoOptimization(p1)
      const p2 = useProjectStore.getState().projects.find((x) => x.id === projectId)
      if (!p2) {
        return {
          ok: false,
          error: 'project not found',
          code: 'PROJECT_MISSING',
          message: 'Project not found.',
        }
      }
      return {
        ok: true,
        enabled: p2.autoOptimizationEnabled,
        intervalMs: p2.autoOptimizationIntervalMs,
      }
    },
    async getStatus(projectId) {
      const p = useProjectStore.getState().projects.find((x) => x.id === projectId)
      if (!p) return { ok: false, error: 'project not found' }
      return {
        ok: true,
        enabled: p.autoOptimizationEnabled,
        intervalMs: p.autoOptimizationIntervalMs,
        lastRunAt: null,
      }
    },
  }
  ;(window as unknown as { __wrdeskOptimizerHttp?: BridgeApi }).__wrdeskOptimizerHttp = api
}

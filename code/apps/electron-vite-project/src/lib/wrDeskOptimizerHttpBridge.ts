/**
 * Exposes `window.__wrdeskOptimizerHttp` for the Electron main HTTP server
 * (`/api/projects/:id/optimize/*`) via `executeJavaScript`.
 */
import { useProjectStore } from '../stores/useProjectStore'
import {
  startAutoOptimization,
  stopAutoOptimization,
  triggerSnapshotOptimization,
} from './autoOptimizationEngine'

type BridgeApi = {
  snapshot: (projectId: string) => Promise<{ ok: boolean; error?: string }>
  setContinuous: (
    projectId: string,
    enabled: boolean,
  ) => Promise<{ ok: boolean; enabled?: boolean; intervalMs?: number; error?: string }>
  getStatus: (
    projectId: string,
  ) => Promise<{ ok: boolean; enabled?: boolean; intervalMs?: number; lastRunAt?: number | null; error?: string }>
}

export function registerWrDeskOptimizerHttpBridge(): void {
  const api: BridgeApi = {
    async snapshot(projectId) {
      const p = useProjectStore.getState().projects.find((x) => x.id === projectId)
      if (!p) return { ok: false, error: 'project not found' }
      triggerSnapshotOptimization(p)
      return { ok: true }
    },
    async setContinuous(projectId, enabled) {
      const store = useProjectStore.getState()
      store.setAutoOptimization(projectId, enabled)
      const p = useProjectStore.getState().projects.find((x) => x.id === projectId)
      if (!p) return { ok: false, error: 'project not found' }
      if (enabled) startAutoOptimization(p)
      else stopAutoOptimization()
      return {
        ok: true,
        enabled: p.autoOptimizationEnabled,
        intervalMs: p.autoOptimizationIntervalMs,
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

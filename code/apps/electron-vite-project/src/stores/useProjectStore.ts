/**
 * WR Desk™ — Project store (Zustand v5 + localStorage persistence).
 *
 * V1: persists to localStorage under 'wr-desk-projects'.
 * V2 intent: replace localStorage with IPC ↔ SQLite in the main process.
 *   // TODO: load from window.emailInbox.getOrchestratorSessions() or equivalent IPC
 *
 * DO NOT import this file in the main process.
 *
 * The existing `useProjectSetupChatContextStore` is intentionally kept separate
 * (renderer-only session drafts for the AI chat prefix). Re-exported here so
 * consumers can import both stores from one place.
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type {
  OrchestratorSession,
  Project,
  ProjectAttachment,
  ProjectMilestone,
} from '../types/projectTypes'

// Re-export for convenience — do NOT rewrite the original store.
export {
  useProjectSetupChatContextStore,
  projectSetupChatHasBridgeableContent,
} from './useProjectSetupChatContextStore'
export type {
  ProjectSetupChatSnippet,
  ProjectSetupChatContextState,
} from './useProjectSetupChatContextStore'

// ── Store types ───────────────────────────────────────────────────────────────

interface ProjectState {
  projects: Project[]
  activeProjectId: string | null
  /**
   * Cached list of orchestrator sessions available for linking.
   * Populated on mount via IPC; starts empty.
   * // TODO: load from window.emailInbox.getOrchestratorSessions() or equivalent IPC
   */
  orchestratorSessions: OrchestratorSession[]
}

interface ProjectActions {
  // ── Project CRUD ──────────────────────────────────────────────────────────
  /** Creates a new project and returns its generated id. */
  createProject: (data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => string
  updateProject: (id: string, updates: Partial<Omit<Project, 'id' | 'createdAt'>>) => void
  deleteProject: (id: string) => void
  setActiveProject: (id: string | null) => void

  // ── Milestones ────────────────────────────────────────────────────────────
  addMilestone: (projectId: string, title: string) => void
  toggleMilestoneComplete: (projectId: string, milestoneId: string) => void
  removeMilestone: (projectId: string, milestoneId: string) => void
  /** Reorder milestones by supplying the full ordered array of IDs. */
  reorderMilestones: (projectId: string, milestoneIds: string[]) => void

  // ── Attachments ───────────────────────────────────────────────────────────
  addAttachment: (
    projectId: string,
    attachment: Omit<ProjectAttachment, 'id' | 'addedAt'>,
  ) => void
  removeAttachment: (projectId: string, attachmentId: string) => void

  // ── Session linking ───────────────────────────────────────────────────────
  linkSession: (projectId: string, sessionId: string | null) => void
  setOrchestratorSessions: (sessions: OrchestratorSession[]) => void

  // ── Auto-optimization ─────────────────────────────────────────────────────
  setAutoOptimization: (projectId: string, enabled: boolean) => void
  setAutoOptimizationInterval: (projectId: string, intervalMs: number) => void

  // ── Computed helpers (access store state internally via get()) ────────────
  getActiveProject: () => Project | null
  getActiveMilestone: () => ProjectMilestone | null
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString()
}

function patchProject(
  projects: Project[],
  id: string,
  fn: (p: Project) => Project,
): Project[] {
  return projects.map((p) => (p.id === id ? fn(p) : p))
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useProjectStore = create<ProjectState & ProjectActions>()(
  persist(
    (set, get) => ({
      // ── Initial state ─────────────────────────────────────────────────────
      projects: [],
      activeProjectId: null,
      orchestratorSessions: [],

      // ── Project CRUD ──────────────────────────────────────────────────────
      createProject: (data) => {
        const id = crypto.randomUUID()
        const ts = now()
        const project: Project = { ...data, id, createdAt: ts, updatedAt: ts }
        set((s) => ({ projects: [...s.projects, project] }))
        return id
      },

      updateProject: (id, updates) =>
        set((s) => ({
          projects: patchProject(s.projects, id, (p) => ({
            ...p,
            ...updates,
            id,
            updatedAt: now(),
          })),
        })),

      deleteProject: (id) =>
        set((s) => ({
          projects: s.projects.filter((p) => p.id !== id),
          activeProjectId: s.activeProjectId === id ? null : s.activeProjectId,
        })),

      setActiveProject: (id) => set({ activeProjectId: id }),

      // ── Milestones ────────────────────────────────────────────────────────
      addMilestone: (projectId, title) => {
        const milestone: ProjectMilestone = {
          id: crypto.randomUUID(),
          title: title.trim(),
          completed: false,
          completedAt: null,
          createdAt: now(),
        }
        set((s) => ({
          projects: patchProject(s.projects, projectId, (p) => ({
            ...p,
            milestones: [...p.milestones, milestone],
            updatedAt: now(),
          })),
        }))
      },

      toggleMilestoneComplete: (projectId, milestoneId) =>
        set((s) => ({
          projects: patchProject(s.projects, projectId, (p) => ({
            ...p,
            milestones: p.milestones.map((m) =>
              m.id === milestoneId
                ? {
                    ...m,
                    completed: !m.completed,
                    completedAt: !m.completed ? now() : null,
                  }
                : m,
            ),
            updatedAt: now(),
          })),
        })),

      removeMilestone: (projectId, milestoneId) =>
        set((s) => ({
          projects: patchProject(s.projects, projectId, (p) => ({
            ...p,
            milestones: p.milestones.filter((m) => m.id !== milestoneId),
            updatedAt: now(),
          })),
        })),

      reorderMilestones: (projectId, milestoneIds) =>
        set((s) => ({
          projects: patchProject(s.projects, projectId, (p) => {
            const map = new Map(p.milestones.map((m) => [m.id, m]))
            const reordered = milestoneIds
              .map((id) => map.get(id))
              .filter((m): m is ProjectMilestone => m !== undefined)
            return { ...p, milestones: reordered, updatedAt: now() }
          }),
        })),

      // ── Attachments ───────────────────────────────────────────────────────
      addAttachment: (projectId, data) => {
        const attachment: ProjectAttachment = {
          id: crypto.randomUUID(),
          addedAt: now(),
          ...data,
        }
        set((s) => ({
          projects: patchProject(s.projects, projectId, (p) => ({
            ...p,
            attachments: [...p.attachments, attachment],
            updatedAt: now(),
          })),
        }))
      },

      removeAttachment: (projectId, attachmentId) =>
        set((s) => ({
          projects: patchProject(s.projects, projectId, (p) => ({
            ...p,
            attachments: p.attachments.filter((a) => a.id !== attachmentId),
            updatedAt: now(),
          })),
        })),

      // ── Session linking ───────────────────────────────────────────────────
      linkSession: (projectId, sessionId) =>
        set((s) => ({
          projects: patchProject(s.projects, projectId, (p) => ({
            ...p,
            linkedSessionId: sessionId,
            updatedAt: now(),
          })),
        })),

      setOrchestratorSessions: (sessions) => set({ orchestratorSessions: sessions }),

      // ── Auto-optimization ─────────────────────────────────────────────────
      setAutoOptimization: (projectId, enabled) =>
        set((s) => ({
          projects: patchProject(s.projects, projectId, (p) => ({
            ...p,
            autoOptimizationEnabled: enabled,
            updatedAt: now(),
          })),
        })),

      setAutoOptimizationInterval: (projectId, intervalMs) =>
        set((s) => ({
          projects: patchProject(s.projects, projectId, (p) => ({
            ...p,
            autoOptimizationIntervalMs: intervalMs,
            updatedAt: now(),
          })),
        })),

      // ── Computed helpers ──────────────────────────────────────────────────
      getActiveProject: () => {
        const { projects, activeProjectId } = get()
        if (!activeProjectId) return null
        return projects.find((p) => p.id === activeProjectId) ?? null
      },

      getActiveMilestone: () => {
        const { projects, activeProjectId } = get()
        if (!activeProjectId) return null
        const project = projects.find((p) => p.id === activeProjectId)
        return project?.milestones.find((m) => !m.completed) ?? null
      },
    }),
    {
      name: 'wr-desk-projects',
      storage: createJSONStorage(() => localStorage),
      /**
       * Bump `version` when the stored schema changes in a breaking way.
       * V2: replace storage with an IPC-backed adapter.
       */
      version: 1,
    },
  ),
)

// ── Selectors (pure, stable references) ──────────────────────────────────────

/** Returns the active project or null. */
export function selectActiveProject(state: {
  projects: Project[]
  activeProjectId: string | null
}): Project | null {
  if (state.activeProjectId === null) return null
  return state.projects.find((p) => p.id === state.activeProjectId) ?? null
}

/** Returns the first incomplete milestone of the active project, or null. */
export function selectActiveMilestone(state: {
  projects: Project[]
  activeProjectId: string | null
}): ProjectMilestone | null {
  const project = selectActiveProject(state)
  return project?.milestones.find((m) => !m.completed) ?? null
}

/**
 * Milestone completion percentage (0–100), rounded to nearest integer.
 * Returns null when the project has no milestones.
 */
export function milestoneCompletionPct(milestones: readonly ProjectMilestone[]): number | null {
  if (milestones.length === 0) return null
  const done = milestones.filter((m) => m.completed).length
  return Math.round((done / milestones.length) * 100)
}

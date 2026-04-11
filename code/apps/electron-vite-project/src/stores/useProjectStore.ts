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

/** Dashboard automation cards — shortcut icons for top trigger bar (not project entities). */
export type ComposerIconSlot = 'emailComposer' | 'beapComposer'

export interface ComposerIconsState {
  emailComposer?: string
  beapComposer?: string
}

interface ProjectState {
  projects: Project[]
  activeProjectId: string | null
  /**
   * Cached list of orchestrator sessions available for linking.
   * Populated on mount via IPC; starts empty.
   * // TODO: load from window.emailInbox.getOrchestratorSessions() or equivalent IPC
   */
  orchestratorSessions: OrchestratorSession[]
  /** Optional emoji per composer card — persisted with projects under `wr-desk-projects`. */
  composerIcons: ComposerIconsState
}

interface ProjectActions {
  // ── Project CRUD ──────────────────────────────────────────────────────────
  /** Creates a new project and returns its generated id. */
  createProject: (data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => string
  updateProject: (id: string, updates: Partial<Omit<Project, 'id' | 'createdAt'>>) => void
  deleteProject: (id: string) => void
  setActiveProject: (id: string | null) => void

  // ── Milestones ────────────────────────────────────────────────────────────
  addMilestone: (projectId: string, title: string, description?: string) => void
  updateMilestone: (
    projectId: string,
    milestoneId: string,
    updates: Partial<Pick<ProjectMilestone, 'title' | 'description'>>,
  ) => void
  toggleMilestoneComplete: (projectId: string, milestoneId: string) => void
  /** Sets isActive = true for this milestone, false for all others in the project. */
  setActiveMilestone: (projectId: string, milestoneId: string) => void
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
  setLinkedSessionIds: (projectId: string, sessionIds: string[]) => void
  setOrchestratorSessions: (sessions: OrchestratorSession[]) => void

  /** Sets or clears project icon (emoji string). Empty string clears `icon`. */
  setProjectIcon: (projectId: string, icon: string) => void

  /** Emoji shortcut for Email / BEAP composer cards (dashboard trigger bar — Prompt 3). */
  setComposerIcon: (composerId: ComposerIconSlot, icon: string) => void
  clearComposerIcon: (composerId: ComposerIconSlot) => void

  // ── Auto-optimization ─────────────────────────────────────────────────────
  setAutoOptimization: (projectId: string, enabled: boolean) => void
  setAutoOptimizationInterval: (projectId: string, intervalMs: number) => void
  acceptOptimizationSuggestion: (
    projectId: string,
    entry: { runId: string; agentBoxId: string; text: string },
  ) => void

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
      composerIcons: {},

      // ── Project CRUD ──────────────────────────────────────────────────────
      createProject: (data) => {
        const id = crypto.randomUUID()
        const ts = now()
        const project: Project = {
          ...data,
          id,
          createdAt: ts,
          updatedAt: ts,
          autoOptimizationEnabled: data.autoOptimizationEnabled ?? false,
          autoOptimizationIntervalMs: data.autoOptimizationIntervalMs ?? 300_000,
          linkedSessionIds: data.linkedSessionIds ?? [],
        }
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
      addMilestone: (projectId, title, description) => {
        const milestone: ProjectMilestone = {
          id: crypto.randomUUID(),
          title: title.trim(),
          description: description ?? '',
          isActive: false,
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

      updateMilestone: (projectId, milestoneId, updates) =>
        set((s) => ({
          projects: patchProject(s.projects, projectId, (p) => ({
            ...p,
            milestones: p.milestones.map((m) =>
              m.id === milestoneId ? { ...m, ...updates, id: m.id } : m,
            ),
            updatedAt: now(),
          })),
        })),

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

      setActiveMilestone: (projectId, milestoneId) =>
        set((s) => ({
          projects: patchProject(s.projects, projectId, (p) => ({
            ...p,
            milestones: p.milestones.map((m) => ({
              ...m,
              isActive: m.id === milestoneId,
            })),
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
      setLinkedSessionIds: (projectId, sessionIds) =>
        set((s) => ({
          projects: patchProject(s.projects, projectId, (p) => ({
            ...p,
            linkedSessionIds: [...sessionIds],
            updatedAt: now(),
          })),
        })),

      setOrchestratorSessions: (sessions) => set({ orchestratorSessions: sessions }),

      setProjectIcon: (projectId, icon) => {
        const trimmed = icon.trim()
        set((s) => ({
          projects: patchProject(s.projects, projectId, (p) => ({
            ...p,
            ...(trimmed ? { icon: trimmed } : { icon: undefined }),
            updatedAt: now(),
          })),
        }))
      },

      setComposerIcon: (composerId, icon) => {
        const trimmed = icon.trim()
        if (!trimmed) {
          get().clearComposerIcon(composerId)
          return
        }
        set((s) => ({
          composerIcons: { ...(s.composerIcons ?? {}), [composerId]: trimmed },
        }))
      },

      clearComposerIcon: (composerId) =>
        set((s) => {
          const prev = s.composerIcons ?? {}
          const { [composerId]: _removed, ...rest } = prev
          return { composerIcons: rest }
        }),

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

      acceptOptimizationSuggestion: (projectId, entry) =>
        set((s) => ({
          projects: patchProject(s.projects, projectId, (p) => ({
            ...p,
            acceptedSuggestions: [
              ...(p.acceptedSuggestions ?? []),
              { ...entry, acceptedAt: now() },
            ],
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
        if (!project) return null
        // Prefer explicitly set active milestone, fall back to first incomplete
        return project.milestones.find((m) => m.isActive)
          ?? project.milestones.find((m) => !m.completed)
          ?? null
      },
    }),
    {
      /**
       * **localStorage key — stable contract.** Main process reads this key via
       * `readTriggerProjectEntriesFromRenderer` (trigger bar). Extension code may read the same key
       * (e.g. `chatFocusLlmPrefix`). Persisted shape is Zustand persist `{ state, version }`.
       * Do not rename casually; coordinate migrations and any non-renderer consumers.
       */
      name: 'wr-desk-projects',
      storage: createJSONStorage(() => localStorage),
      /**
       * Bump `version` when the stored schema changes in a breaking way.
       * V2: `linkedSessionId` → `linkedSessionIds[]`
       * V3: ensure `autoOptimizationEnabled` defaults to false when missing (legacy stores).
       * V5: `composerIcons` for dashboard Email/BEAP shortcut icons.
       */
      version: 5,
      migrate: (persistedState: unknown, version: number) => {
        const ps = persistedState as {
          state?: {
            projects?: Array<Record<string, unknown>>
            composerIcons?: ComposerIconsState
          }
        }
        if (ps?.state && typeof ps.state === 'object' && version < 5) {
          if (!ps.state.composerIcons || typeof ps.state.composerIcons !== 'object') {
            ps.state.composerIcons = {}
          }
        }
        if (ps?.state?.projects && Array.isArray(ps.state.projects)) {
          if (version < 2) {
            ps.state.projects = ps.state.projects.map((p) => {
              if (Array.isArray(p.linkedSessionIds)) return p as Record<string, unknown>
              const ids = p.linkedSessionId ? [String(p.linkedSessionId)] : []
              const { linkedSessionId: _ls, ...rest } = p
              return { ...rest, linkedSessionIds: ids }
            })
          }
          if (version < 3) {
            ps.state.projects = ps.state.projects.map((p) => ({
              ...p,
              autoOptimizationEnabled:
                typeof p.autoOptimizationEnabled === 'boolean' ? p.autoOptimizationEnabled : false,
            }))
          }
          if (version < 4) {
            ps.state.projects = ps.state.projects.map((p) => {
              const rawMs = p.milestones
              if (!Array.isArray(rawMs)) return p
              return {
                ...p,
                milestones: rawMs.map((m) => {
                  const row = m as Record<string, unknown>
                  return {
                    ...row,
                    description: typeof row.description === 'string' ? row.description : '',
                  }
                }),
              }
            })
          }
        }
        return persistedState as object
      },
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

/** Returns the active milestone of the active project.
 *  Prefers isActive === true; falls back to first incomplete. */
export function selectActiveMilestone(state: {
  projects: Project[]
  activeProjectId: string | null
}): ProjectMilestone | null {
  const project = selectActiveProject(state)
  if (!project) return null
  return project.milestones.find((m) => m.isActive)
    ?? project.milestones.find((m) => !m.completed)
    ?? null
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

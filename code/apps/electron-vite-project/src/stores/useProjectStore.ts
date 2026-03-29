/**
 * WR Desk™ — Project store (Zustand v5 + localStorage persistence).
 *
 * V1: persists to localStorage under 'wrdesk-projects-v1'.
 * V2 intent: replace localStorage with IPC ↔ SQLite in the main process;
 * the action API surface should remain unchanged to ease that migration.
 *
 * DO NOT import this file in the main process.
 *
 * The existing `useProjectSetupChatContextStore` is intentionally kept
 * separate (renderer-only, session-only drafts for the AI chat prefix).
 * Re-exported here for convenience so consumers can import both from one place.
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type {
  AnalysisSession,
  AgentSlot,
  AttachmentType,
  MilestoneStatus,
  Project,
  ProjectAttachment,
  ProjectGoal,
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

// ── Predefined session templates ──────────────────────────────────────────────

function makeSlot(label: string, agentType: string, enabled = true): AgentSlot {
  return {
    id: crypto.randomUUID(),
    label,
    agentType,
    enabled,
    lastOutput: null,
    lastRunAt: null,
    confidence: null,
  }
}

export const SESSION_TEMPLATES: Readonly<Record<string, readonly AgentSlot[]>> = {
  security: [
    makeSlot('Risk Analysis',     'risk'),
    makeSlot('Security Audit',    'security'),
    makeSlot('Threat Detection',  'threat'),
    makeSlot('Compliance Review', 'compliance'),
    makeSlot('Gap Analysis',      'gap'),
    makeSlot('Vulnerability Scan','vuln', false),
  ],
  growth: [
    makeSlot('Lead Analytics',   'lead'),
    makeSlot('Campaign Review',  'campaign'),
    makeSlot('Partner Signals',  'partner'),
    makeSlot('Churn Indicators', 'churn', false),
  ],
  full: [
    makeSlot('Risk Analysis',     'risk'),
    makeSlot('Security Audit',    'security'),
    makeSlot('Threat Detection',  'threat'),
    makeSlot('Lead Analytics',    'lead'),
    makeSlot('Gap Analysis',      'gap'),
    makeSlot('Compliance Review', 'compliance'),
  ],
  custom: [],
}

// ── Store types ───────────────────────────────────────────────────────────────

interface ProjectState {
  projects: Project[]
  activeProjectId: string | null
  sessions: AnalysisSession[]
}

interface ProjectActions {
  // ── Projects ─────────────────────────────────────────────────────────────
  addProject: (project: Project) => void
  updateProject: (id: string, patch: Partial<Omit<Project, 'id' | 'createdAt'>>) => void
  deleteProject: (id: string) => void
  setActiveProjectId: (id: string | null) => void

  // ── Milestones ────────────────────────────────────────────────────────────
  addMilestone: (projectId: string, milestone: ProjectMilestone) => void
  updateMilestoneStatus: (projectId: string, milestoneId: string, status: MilestoneStatus) => void
  updateMilestone: (projectId: string, milestoneId: string, patch: Partial<Omit<ProjectMilestone, 'id'>>) => void
  removeMilestone: (projectId: string, milestoneId: string) => void
  /**
   * Reorder milestone by moving it one position up or down.
   * Swaps `order` values between the milestone and its neighbour.
   */
  moveMilestone: (projectId: string, milestoneId: string, direction: 'up' | 'down') => void

  // ── Attachments ───────────────────────────────────────────────────────────
  addAttachment: (projectId: string, label: string, content: string, type: AttachmentType) => void
  removeAttachment: (projectId: string, attachmentId: string) => void
  updateAttachment: (projectId: string, attachmentId: string, patch: Partial<Pick<ProjectAttachment, 'label' | 'content' | 'type'>>) => void

  // ── Sessions ──────────────────────────────────────────────────────────────
  addSession: (session: AnalysisSession) => void
  updateSession: (id: string, patch: Partial<Omit<AnalysisSession, 'id'>>) => void
  deleteSession: (id: string) => void
  updateAgentSlot: (sessionId: string, slotId: string, patch: Partial<Omit<AgentSlot, 'id'>>) => void

  // ── Project ↔ session linking ────────────────────────────────────────────
  /**
   * Link an existing session to a project (and back-link the project on the session).
   * Pass `null` for `sessionId` to unlink.
   */
  linkSessionToProject: (projectId: string, sessionId: string | null) => void

  // ── Feature toggles ───────────────────────────────────────────────────────
  toggleAutoOptimization: (projectId: string) => void
  toggleSnapshotCapture: (projectId: string) => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString()
}

function patchProject(
  projects: Project[],
  id: string,
  patchFn: (p: Project) => Project,
): Project[] {
  return projects.map((p) => (p.id === id ? patchFn(p) : p))
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useProjectStore = create<ProjectState & ProjectActions>()(
  persist(
    (set, get) => ({
      // ── Initial state ─────────────────────────────────────────────────────
      projects: [],
      activeProjectId: null,
      sessions: [],

      // ── Project CRUD ──────────────────────────────────────────────────────
      addProject: (project) =>
        set((s) => ({ projects: [...s.projects, project] })),

      updateProject: (id, patch) =>
        set((s) => ({
          projects: patchProject(s.projects, id, (p) => ({
            ...p,
            ...patch,
            id,
            updatedAt: now(),
          })),
        })),

      deleteProject: (id) =>
        set((s) => ({
          projects: s.projects.filter((p) => p.id !== id),
          activeProjectId: s.activeProjectId === id ? null : s.activeProjectId,
        })),

      setActiveProjectId: (id) => set({ activeProjectId: id }),

      // ── Milestone CRUD ────────────────────────────────────────────────────
      addMilestone: (projectId, milestone) =>
        set((s) => ({
          projects: patchProject(s.projects, projectId, (p) => ({
            ...p,
            milestones: [...p.milestones, milestone],
            updatedAt: now(),
          })),
        })),

      updateMilestoneStatus: (projectId, milestoneId, status) => {
        const completedAt = status === 'completed' ? now() : null
        set((s) => ({
          projects: patchProject(s.projects, projectId, (p) => ({
            ...p,
            milestones: p.milestones.map((m) =>
              m.id === milestoneId ? { ...m, status, completedAt } : m,
            ),
            updatedAt: now(),
          })),
        }))
      },

      updateMilestone: (projectId, milestoneId, patch) =>
        set((s) => ({
          projects: patchProject(s.projects, projectId, (p) => ({
            ...p,
            milestones: p.milestones.map((m) =>
              m.id === milestoneId ? { ...m, ...patch } : m,
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

      moveMilestone: (projectId, milestoneId, direction) =>
        set((s) => ({
          projects: patchProject(s.projects, projectId, (p) => {
            const sorted = [...p.milestones].sort((a, b) => a.order - b.order)
            const idx = sorted.findIndex((m) => m.id === milestoneId)
            if (idx < 0) return p
            const swapIdx = direction === 'up' ? idx - 1 : idx + 1
            if (swapIdx < 0 || swapIdx >= sorted.length) return p
            // Swap order values
            const updated = sorted.map((m, i) => {
              if (i === idx) return { ...m, order: sorted[swapIdx].order }
              if (i === swapIdx) return { ...m, order: sorted[idx].order }
              return m
            })
            return { ...p, milestones: updated, updatedAt: now() }
          }),
        })),

      // ── Attachment CRUD ───────────────────────────────────────────────────
      addAttachment: (projectId, label, content, type) => {
        const attachment: ProjectAttachment = {
          id: crypto.randomUUID(),
          label,
          content,
          type,
          addedAt: now(),
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

      updateAttachment: (projectId, attachmentId, patch) =>
        set((s) => ({
          projects: patchProject(s.projects, projectId, (p) => ({
            ...p,
            attachments: p.attachments.map((a) =>
              a.id === attachmentId ? { ...a, ...patch } : a,
            ),
            updatedAt: now(),
          })),
        })),

      // ── Session CRUD ──────────────────────────────────────────────────────
      addSession: (session) =>
        set((s) => ({ sessions: [...s.sessions, session] })),

      updateSession: (id, patch) =>
        set((s) => ({
          sessions: s.sessions.map((sess) =>
            sess.id === id ? { ...sess, ...patch } : sess,
          ),
        })),

      deleteSession: (id) => {
        set((s) => {
          // Unlink from any project that references this session
          const projects = s.projects.map((p) =>
            p.linkedSessionId === id ? { ...p, linkedSessionId: null, updatedAt: now() } : p,
          )
          return { sessions: s.sessions.filter((sess) => sess.id !== id), projects }
        })
      },

      updateAgentSlot: (sessionId, slotId, patch) =>
        set((s) => ({
          sessions: s.sessions.map((sess) =>
            sess.id === sessionId
              ? {
                  ...sess,
                  agents: sess.agents.map((a) =>
                    a.id === slotId ? { ...a, ...patch } : a,
                  ),
                }
              : sess,
          ),
        })),

      // ── Linking ───────────────────────────────────────────────────────────
      linkSessionToProject: (projectId, sessionId) => {
        set((s) => {
          // Clear back-link on the old session if there was one
          const oldProject = s.projects.find((p) => p.id === projectId)
          const oldSessionId = oldProject?.linkedSessionId ?? null

          const sessions = s.sessions.map((sess) => {
            if (oldSessionId && sess.id === oldSessionId && sess.linkedProjectId === projectId) {
              return { ...sess, linkedProjectId: null }
            }
            if (sessionId && sess.id === sessionId) {
              return { ...sess, linkedProjectId: projectId }
            }
            return sess
          })

          const projects = patchProject(s.projects, projectId, (p) => ({
            ...p,
            linkedSessionId: sessionId,
            updatedAt: now(),
          }))

          return { projects, sessions }
        })
      },

      // ── Feature toggles ───────────────────────────────────────────────────
      toggleAutoOptimization: (projectId) =>
        set((s) => ({
          projects: patchProject(s.projects, projectId, (p) => ({
            ...p,
            autoOptimization: !p.autoOptimization,
            updatedAt: now(),
          })),
        })),

      toggleSnapshotCapture: (projectId) =>
        set((s) => ({
          projects: patchProject(s.projects, projectId, (p) => ({
            ...p,
            snapshotCapture: !p.snapshotCapture,
            updatedAt: now(),
          })),
        })),
    }),
    {
      name: 'wrdesk-projects-v1',
      storage: createJSONStorage(() => localStorage),
      /**
       * Bump `version` when the stored schema changes in a breaking way.
       * Add a `migrate` function to handle old persisted data.
       * V2: replace storage with an IPC-backed adapter.
       */
      version: 1,
    },
  ),
)

// ── Selectors (pure, memoisation-friendly) ────────────────────────────────────

/** Returns the active project or null. Prefer this over manual `.find()` in components. */
export function selectActiveProject(state: ProjectState & ProjectActions): Project | null {
  if (state.activeProjectId === null) return null
  return state.projects.find((p) => p.id === state.activeProjectId) ?? null
}

/** Returns the session linked to the given project, or null. */
export function selectLinkedSession(
  state: ProjectState & ProjectActions,
  project: Project | null,
): AnalysisSession | null {
  if (!project?.linkedSessionId) return null
  return state.sessions.find((s) => s.id === project.linkedSessionId) ?? null
}

/**
 * Milestone completion percentage (0–100), rounded to nearest integer.
 * Returns `null` when there are no milestones.
 */
export function milestoneCompletionPct(milestones: readonly ProjectMilestone[]): number | null {
  if (milestones.length === 0) return null
  const done = milestones.filter((m) => m.status === 'completed').length
  return Math.round((done / milestones.length) * 100)
}

/**
 * Helper to build a new `Project` record with safe defaults.
 * Components should use this instead of constructing `Project` objects manually.
 */
export function buildNewProject(
  name: string,
  goalTitle: string,
  goalSummary: string,
): Project {
  const ts = now()
  return {
    id: crypto.randomUUID(),
    name: name.trim() || 'Untitled Project',
    goal: {
      id: crypto.randomUUID(),
      title: goalTitle.trim() || 'Project Goal',
      summary: goalSummary.trim(),
      createdAt: ts,
      updatedAt: ts,
    },
    milestones: [],
    attachments: [],
    linkedSessionId: null,
    autoOptimization: false,
    snapshotCapture: false,
    createdAt: ts,
    updatedAt: ts,
  }
}

/**
 * Helper to build a new `AnalysisSession` from a named template.
 * Pass `templateKey = 'custom'` for an empty custom session.
 */
export function buildNewSession(name: string, templateKey: keyof typeof SESSION_TEMPLATES): AnalysisSession {
  const template = SESSION_TEMPLATES[templateKey] ?? []
  return {
    id: crypto.randomUUID(),
    name: name.trim() || 'Analysis Session',
    agents: template.map((a) => ({ ...a, id: crypto.randomUUID() })),
    linkedProjectId: null,
    autoInterval: 0,
    lastRunAt: null,
  }
}

/**
 * WR Desk™ — Project data model types (V2 schema).
 *
 * V1: renderer-side persistence via useProjectStore + localStorage.
 * V2 intent: IPC ↔ SQLite in the main process; wire format stays compatible.
 *
 * DO NOT import in the main process.
 */

export type IsoDateString = string

// ── Milestone ─────────────────────────────────────────────────────────────────

export interface ProjectMilestone {
  id: string
  title: string
  /** Only one milestone can be isActive === true per project at a time.
   *  This is the milestone currently shown in the dashboard roadmap area.
   *  Falls back to first incomplete milestone if none is explicitly set. */
  isActive: boolean
  completed: boolean
  completedAt: IsoDateString | null
  createdAt: IsoDateString
}

// ── Attachment ────────────────────────────────────────────────────────────────

export interface ProjectAttachment {
  id: string
  /** Original filename as uploaded. */
  filename: string
  /** Extracted plain text. For PDFs: raw content until IPC extraction lands. */
  content: string
  /** MIME type, e.g. "application/pdf", "text/plain". */
  mimeType: string
  addedAt: IsoDateString
  /** Extraction lifecycle badge — matches AttachmentParseStatus from beap-builder. */
  parseStatus?: 'pending' | 'success' | 'failed'
}

// ── Project ───────────────────────────────────────────────────────────────────

export interface Project {
  id: string
  title: string
  description: string
  goals: string
  milestones: ProjectMilestone[]
  attachments: ProjectAttachment[]
  /** References an external orchestrator session by ID. Null = unlinked. */
  linkedSessionId: string | null
  autoOptimizationEnabled: boolean
  /** Interval in ms; default 300 000 (5 min). */
  autoOptimizationIntervalMs: number
  createdAt: IsoDateString
  updatedAt: IsoDateString
}

// ── Orchestrator session (read-only reference, populated via IPC) ─────────────

export interface OrchestratorSession {
  id: string
  name: string
  createdAt: IsoDateString
}

// ── Auto-optimization interval helpers ───────────────────────────────────────

export type AutoOptimizationInterval = 60000 | 300000 | 600000 | 1800000 | 3600000

export const AUTO_OPTIMIZATION_INTERVALS: { label: string; value: AutoOptimizationInterval }[] = [
  { label: '1 min',  value: 60000 },
  { label: '5 min',  value: 300000 },
  { label: '10 min', value: 600000 },
  { label: '30 min', value: 1800000 },
  { label: '1 hour', value: 3600000 },
]

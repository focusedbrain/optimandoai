/**
 * WR Desk™ — Project data model types.
 *
 * These types back the renderer-side `useProjectStore` (Zustand + localStorage).
 * V2 intent: persist to Electron's main process via IPC/SQLite and remove
 * the localStorage dependency. Fields are designed to be wire-serialisable
 * without change.
 *
 * No IPC, no main-process code required in V1.
 */

// ── ISO 8601 string alias (same convention as analysisDashboardSnapshot) ─────

export type IsoDateString = string

// ── Project goal ──────────────────────────────────────────────────────────────

/**
 * A single goal record attached to a project.
 * One project has exactly one goal; the object is a record so it can be
 * independently updated without diffing the parent project.
 */
export interface ProjectGoal {
  readonly id: string
  /** Short heading shown in the dashboard title area. */
  readonly title: string
  /** 1–4 sentence summary shown in the Goal & Roadmap section. */
  readonly summary: string
  readonly createdAt: IsoDateString
  readonly updatedAt: IsoDateString
}

// ── Milestones ────────────────────────────────────────────────────────────────

export type MilestoneStatus = 'pending' | 'in_progress' | 'completed'

export interface ProjectMilestone {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly status: MilestoneStatus
  /**
   * 0-based display order within the project. Used for timeline rendering
   * and drag-to-reorder. Up/down arrow controls are the V1 UI.
   */
  readonly order: number
  readonly completedAt: IsoDateString | null
}

// ── Attachments ───────────────────────────────────────────────────────────────

export type AttachmentType = 'context' | 'note' | 'snippet'

/**
 * A named text artifact attached to a project.
 *
 * - `context` — background info, policy docs, constraints
 * - `note`    — ad-hoc observations
 * - `snippet` — short reusable reference text (similar to existing ProjectSetupChatSnippets)
 *
 * `content` is plain text; rich-text support is a V2 concern.
 */
export interface ProjectAttachment {
  readonly id: string
  readonly label: string
  /** Plain-text body. No length limit enforced at the type level. */
  readonly content: string
  readonly type: AttachmentType
  readonly addedAt: IsoDateString
}

// ── Agent slots ───────────────────────────────────────────────────────────────

/**
 * A pre-configured analysis role within an `AnalysisSession`.
 *
 * In V1, agent execution is manual (user triggers "Run Analysis Now").
 * `lastOutput` and `confidence` are stored here for display — they are
 * not written by any automated background process yet.
 * V2 intent: agent execution via IPC → LLM → write-back to the session.
 */
export interface AgentSlot {
  readonly id: string
  /** Human-readable role label, e.g. "Risk Analysis", "Security Audit". */
  readonly label: string
  /**
   * Machine identifier for the agent type.
   * Used for template matching and future IPC routing.
   */
  readonly agentType: string
  /** Whether this slot is active in the current session. */
  readonly enabled: boolean
  /** Most recent output text from the agent (truncated for display). `null` = not yet run. */
  readonly lastOutput: string | null
  readonly lastRunAt: IsoDateString | null
  /**
   * Fractional confidence 0–1.
   * `null` = not yet computed; do not render a bar.
   */
  readonly confidence: number | null
}

// ── Analysis session ──────────────────────────────────────────────────────────

/**
 * A named collection of agent slots linked (optionally) to a project.
 *
 * `autoInterval = 0` means manual-only.
 * V2 intent: positive `autoInterval` triggers a scheduled IPC call.
 */
export interface AnalysisSession {
  readonly id: string
  readonly name: string
  readonly agents: readonly AgentSlot[]
  /**
   * Back-link to the owning project. Also set on the `Project` side via
   * `linkedSessionId`. Both must be updated atomically in the store.
   */
  readonly linkedProjectId: string | null
  /** Interval in ms. `0` = manual only. */
  readonly autoInterval: number
  readonly lastRunAt: IsoDateString | null
}

// ── Project ───────────────────────────────────────────────────────────────────

/**
 * Top-level project record.
 *
 * V1 persistence: Zustand `persist` → localStorage.
 * V2 intent: IPC → SQLite in main process; remove localStorage dependency.
 */
export interface Project {
  readonly id: string
  readonly name: string
  readonly goal: ProjectGoal
  readonly milestones: readonly ProjectMilestone[]
  readonly attachments: readonly ProjectAttachment[]
  /**
   * Foreign key to `AnalysisSession.id`.
   * `null` = no session configured yet.
   */
  readonly linkedSessionId: string | null
  /**
   * When true, the project is in auto-analysis mode.
   * V1: visual indicator only; no background scheduler.
   */
  readonly autoOptimization: boolean
  /**
   * When true, system state snapshots are captured for context.
   * V1: visual indicator only; wires into V2 DOM-capture mechanism.
   */
  readonly snapshotCapture: boolean
  readonly createdAt: IsoDateString
  readonly updatedAt: IsoDateString
}

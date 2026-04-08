/**
 * WR Desk™ — Auto-optimization guard and run correlation types.
 */

export type TriggerSource =
  | 'dashboard_snapshot'
  | 'dashboard_interval'
  | 'dashboard_toggle'
  | 'extension_snapshot'
  | 'extension_continuous'

export type GuardFailCode = 'NO_PROJECT' | 'PROJECT_MISSING' | 'AUTO_OPT_OFF' | 'NO_SESSION'

export type GuardFallback =
  | 'focus_project_selector'
  | 'clear_selection'
  | 'stop_interval'
  | 'noop'
  | 'show_hint'
  | 'open_session_picker'

export type GuardResult =
  | { ok: true; mode: 'RUN' | 'SNAPSHOT_ONLY' }
  | { ok: false; code: GuardFailCode; message: string; fallback: GuardFallback }

/** Serialized display grid surface for LLM consumption (extension DOM capture). */
export interface DomSnapshot {
  capturedAt: string
  gridId: string | null
  layout: string
  slots: DomSlotCapture[]
}

export interface DomSlotCapture {
  boxNumber: number
  agentLabel: string | null
  status: 'idle' | 'running' | 'error' | 'unknown'
  textDigest: string
  truncated: boolean
}

/** ── Optimization context envelope (auto-optimization LLM pipeline) ───────── */

export type OptimizationSource = 'auto-optimization' | 'snapshot' | 'manual'

export interface ProjectSection {
  id: string
  title: string
  description: string
  goals: string
  milestones: Array<{ id: string; title: string; completed: boolean; isActive: boolean }>
}

export interface AgentEntry {
  boxId: string
  boxNumber: number
  title: string
  provider: string | null
  model: string | null
  systemPromptOrRole: string | null
  toolsSummary: string | null
}

export interface SessionSection {
  sessionKey: string
  linkedOrchestratorSessionId: string | null
  agents: AgentEntry[]
}

export interface AttachmentsSection {
  items: Array<{
    id: string
    filename: string
    mimeType: string
    excerpt: string | null
    parseStatus: string | null
  }>
}

export interface AgentOutputEntry {
  agentBoxId: string
  agentLabel: string
  summary: string
  structured?: Record<string, unknown>
}

export interface OptimizationContext {
  version: 1
  runId: string
  source: OptimizationSource
  createdAt: string
  project: ProjectSection
  dom: DomSnapshot | null
  session: SessionSection
  attachments: AttachmentsSection
  priorAgentOutputs: AgentOutputEntry[]
  userMessage: string | null
}

export type LlmSendFn = (
  messages: Array<{ role: string; content: string }>,
  provider?: string,
  model?: string,
) => Promise<string>

export interface AgentRunResult {
  agentBoxId: string
  agentLabel: string
  /** Present when emitted from optimization runners (UI badge). */
  boxNumber?: number
  output: string
  error?: string
  durationMs: number
}

export type SessionActivationFail = { ok: false; code: string; retryable: boolean }

export type OptimizationRunResult =
  | {
      ok: true
      runId: string
      results: AgentRunResult[]
      suggestionCount: number
    }
  | { ok: false; runId: string; guardFail: Extract<GuardResult, { ok: false }> }
  | { ok: false; runId: string; sessionFail: SessionActivationFail }
  | { ok: false; runId: string; error: string }

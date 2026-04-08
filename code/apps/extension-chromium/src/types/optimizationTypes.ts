/**
 * DOM snapshot types (aligned with electron-vite-project `src/types/optimizationTypes.ts`).
 */

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

/** LLM optimization run result for one agent (aligned with electron). */
export interface AgentRunResult {
  agentBoxId: string
  agentLabel: string
  boxNumber?: number
  output: string
  error?: string
  durationMs: number
}

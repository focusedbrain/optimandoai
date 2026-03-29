/**
 * WR Desk™ — Analysis Dashboard Components
 *
 * Barrel export for all premium dashboard components introduced in the
 * Prompts 2–4 refactor. Import from this module to keep AnalysisCanvas.tsx
 * and any future consumer files clean.
 *
 * Legacy components (DashboardTopCardsRow, ProjectSetupSection,
 * UrgentAutosortSessionSection, PoaeArchiveSection) are NOT re-exported here.
 * Their files are kept as reference. Do not import them in new code.
 */

// ── Intelligence Dashboard (Prompt 2) ────────────────────────────────────────
export { IntelligenceDashboard } from './IntelligenceDashboard'

// ── Project Optimization Panel (Prompt 3) ────────────────────────────────────
export {
  ProjectOptimizationPanel,
  type DashboardEmailAccountRow,
  type ProjectOptimizationPanelProps,
} from './ProjectOptimizationPanel'

// ── Activity Feed Column + child panels (Prompt 4) ───────────────────────────
export {
  ActivityFeedColumn,
  type ActivityFeedColumnProps,
} from './ActivityFeedColumn'

export {
  UrgentMessagesPanel,
  type UrgentMessagesPanelProps,
} from './UrgentMessagesPanel'

export {
  PoaeArtifactsPanel,
  type PoaeArtifactsPanelProps,
} from './PoaeArtifactsPanel'

// ── Shared payload type ───────────────────────────────────────────────────────
// Canonical source is UrgentAutosortSessionSection (legacy file, kept for
// reference). Re-exported here so consumers don't reach into the old file.
export type { OpenInboxMessagePayload } from './UrgentAutosortSessionSection'

/**
 * stripAgentBoxesFromGrids — Builder-side runtime normalization (PR 3/8)
 *
 * The artefact's canonical wire format (per Canon A.3.054.8, PR 1 amendment)
 * does NOT carry `agentBoxes[]` inside `display_grids[]` entries for
 * OrchestratorSessionContent sessions. Agent boxes are declared at the top level
 * via `OrchestratorSessionContent.agent_boxes[]`.
 *
 * FullSessionExportContent sessions (v1.1.0) carry the complete blob opaquely in
 * `session_export` — no stripping is applied to them, as `session_export` is not
 * recursively validated by the ingestion-core validator.
 *
 * The receiver's `validateSessionImportArtefact` rejects OrchestratorSessionContent
 * grid entries that carry `agentBoxes` (ARTEFACT_UNKNOWN_KEY), making this
 * normalization load-bearing for v1.0.0-style sessions from live runtime state.
 *
 * Per Canon A.3.054.7: Capsule Builder excludes embedded active content.
 * Per Canon A.3.054.8: Artefact wire format follows canonical type declarations.
 */

import type { SessionImportArtefact, OrchestratorSessionContent, FullSessionExportContent } from '../../beap-builder/canonical-types'

/**
 * Returns a copy of `artefact` with `agentBoxes[]` stripped from every
 * `display_grids[]` entry in every OrchestratorSessionContent session.
 * FullSessionExportContent sessions are passed through untouched.
 *
 * Pure transformation — does not mutate the input object.
 * Never throws; delegates no-op path when no sessions present.
 *
 * per Canon A.3.054.8 (PR 1 canon-owner amendment)
 */
export function stripAgentBoxesFromGrids(
  artefact: SessionImportArtefact,
): SessionImportArtefact {
  return {
    ...artefact,
    sessions: artefact.sessions.map(stripFromSession),
  }
}

function stripFromSession(
  session: OrchestratorSessionContent | FullSessionExportContent,
): OrchestratorSessionContent | FullSessionExportContent {
  if (session.session_kind === 'full_session_export') {
    // FullSessionExportContent: session_export is opaque — nothing to strip.
    return session
  }
  // OrchestratorSessionContent: strip agentBoxes from display_grids entries.
  return {
    ...session,
    display_grids: session.display_grids.map((grid) => {
      // Destructure away the runtime-only agentBoxes field (not in canonical type).
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { agentBoxes, ...gridWithoutBoxes } = grid as typeof grid & { agentBoxes?: unknown }
      return gridWithoutBoxes as typeof grid
    }),
  }
}

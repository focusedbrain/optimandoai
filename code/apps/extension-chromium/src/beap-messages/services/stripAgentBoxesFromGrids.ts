/**
 * stripAgentBoxesFromGrids — Builder-side runtime normalization (PR 3/8)
 *
 * The artefact's canonical wire format (per Canon A.3.054.8, PR 1 amendment)
 * does NOT carry `agentBoxes[]` inside `display_grids[]` entries. Agent boxes
 * are declared at the top level via `OrchestratorSessionContent.agent_boxes[]`,
 * with `gridSessionId` + `slotId` linkage fields on each box entry.
 *
 * Runtime persistence paths (e.g. `GRID_SAVE` in `background.ts`) may attach
 * `agentBoxes[]` to grid objects. The Builder strips this field before
 * serialization so the wire capsule is always in canonical form.
 *
 * The receiver's `validateSessionImportArtefact` rejects artefacts whose grid
 * entries carry `agentBoxes` (ARTEFACT_UNKNOWN_KEY), making this normalization
 * load-bearing: without it, the receiver-side validator would reject every
 * artefact produced from live runtime state.
 *
 * Per Canon A.3.054.7: Capsule Builder excludes embedded active content.
 * Per Canon A.3.054.8: Artefact wire format follows canonical type declarations.
 */

import type { SessionImportArtefact, OrchestratorSessionContent } from '../../beap-builder/canonical-types'

/**
 * Returns a copy of `artefact` with `agentBoxes[]` stripped from every
 * `display_grids[]` entry in every session.
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

function stripFromSession(session: OrchestratorSessionContent): OrchestratorSessionContent {
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

/**
 * Canonical Display Grid Configuration
 *
 * Promotes the observed session export/import wire shape for displayGrids[]
 * entries to a typed contract. The runtime storage may carry additional fields
 * (agentBoxes, gridLayout, timestamp); the canonical artefact form does not.
 *
 * @see background.ts GRID_SAVE handler (write path)
 * @see background.ts SAVE_AGENT_BOX_TO_SQLITE gridMetadata (grid-v2 write path)
 * @see sessionImportCore.ts openImportDisplayGrids (read path)
 * @see processFlow.ts DisplayGrid (informal predecessor — loose Record<string, unknown>)
 *
 * @version 1.0.0
 * @module CanonicalDisplayGridConfig
 */

// =============================================================================
// Slot Config
// =============================================================================

/**
 * Slot payload persisted in grid UI (data-slot-config JSON).
 *
 * Closed shape for the session import artefact: only boxNumber is permitted.
 * The validator rejects unknown keys in artefact context (adversarial-closure rule).
 * The runtime grid-script may carry additional fields; the artefact builder (PR 3)
 * strips them before serialization.
 */
export interface DisplayGridSlotConfig {
  /** Agent box number allocated to this slot. */
  boxNumber: number;
}

// =============================================================================
// Inner Config
// =============================================================================

/**
 * Inner config object for a display grid instance.
 *
 * Closed shape for the artefact. The runtime GRID_SAVE payload may include
 * additional top-level fields; the artefact builder (PR 3) strips them.
 */
export interface DisplayGridInnerConfig {
  /** Grid layout identifier (mirrors CanonicalDisplayGridConfig.layout). */
  layout?: string;
  /** Grid session identifier (mirrors CanonicalDisplayGridConfig.sessionId). */
  sessionId?: string;
  /** Map from slot id → slot configuration. */
  slots: Record<string, DisplayGridSlotConfig>;
}

// =============================================================================
// Display Grid Config
// =============================================================================

/**
 * One display grid instance as carried in the session import artefact.
 *
 * Declared fields are the intersection of the two storage write paths:
 *   - background.ts GRID_SAVE (layout, sessionId, config, agentBoxes)
 *   - background.ts SAVE_AGENT_BOX_TO_SQLITE gridMetadata (layout, sessionId, config, timestamp)
 *
 * The artefact form DOES NOT carry agentBoxes. Agent boxes appear at the
 * OrchestratorSessionContent level via agent_boxes[]. Each box carries
 * gridSessionId + slotId linkage fields. Carrying boxes redundantly in
 * display_grids[] would violate the adversarial-closure rule because those
 * boxes have additional runtime fields that are not in CanonicalAgentBoxConfig
 * (e.g. gridLayout, timestamp from grid-script-v2.js). The artefact builder
 * (PR 3) is responsible for stripping agentBoxes before serialization.
 *
 * @see background.ts GRID_SAVE handler
 * @see background.ts SAVE_AGENT_BOX_TO_SQLITE gridMetadata
 * @see processFlow.ts DisplayGrid (informal predecessor)
 */
export interface CanonicalDisplayGridConfig {
  /** Grid layout identifier (e.g. '4-slot'). URL param `layout` on grid-display pages. */
  layout: string;
  /** Stable per-instance identifier. URL param `session` on grid-display pages. */
  sessionId: string;
  /** Layout state — slot map and optional layout/sessionId repetition from v2 grid-script. */
  config: DisplayGridInnerConfig;
  /** ISO 8601 write timestamp. Used for merge/dedup in SQLite saves. Optional in artefact. */
  timestamp?: string;
}

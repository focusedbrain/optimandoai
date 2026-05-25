/**
 * Shared edge configuration state — mirrors main-process deriveEdgeConfigurationState().
 */

export type EdgeConfigurationState =
  | 'not_configured'
  | 'setup_in_progress'
  | 'configured_active'
  | 'configured_unreachable'

const VALID_STATES: ReadonlySet<string> = new Set([
  'not_configured',
  'setup_in_progress',
  'configured_active',
  'configured_unreachable',
])

export function parseEdgeConfigurationState(value: unknown): EdgeConfigurationState {
  if (typeof value === 'string' && VALID_STATES.has(value)) {
    return value as EdgeConfigurationState
  }
  return 'not_configured'
}

export function configurationStateFromDashboardPayload(payload: unknown): EdgeConfigurationState {
  if (typeof payload !== 'object' || payload === null) return 'not_configured'
  return parseEdgeConfigurationState((payload as Record<string, unknown>).edge_configuration_state)
}

/** Primary user-facing next action label per configuration state. */
export function configurationStatePrimaryAction(state: EdgeConfigurationState): string {
  switch (state) {
    case 'not_configured':
      return 'Set up server-side verification'
    case 'setup_in_progress':
      return 'Resume setup'
    case 'configured_active':
    case 'configured_unreachable':
      return 'Manage replicas'
    default:
      return 'Set up server-side verification'
  }
}

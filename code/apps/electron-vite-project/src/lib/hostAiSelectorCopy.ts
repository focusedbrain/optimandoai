/** Tooltips and labels for Host AI in model selectors (orchestrator + WR Chat). */

export const HOST_AI_OPTION_TOOLTIP =
  'Uses the model on your Host — the same idea as choosing a local model, but the model runs on the machine you paired with.'

export const HOST_AI_UNREACHABLE_TOOLTIP =
  'Host not directly reachable. Check that the Host is online, on a reachable network path, and that firewalls or VPN allow the connection.'

/** Placeholder while the internal Host handshake is recognized but capabilities are not ready yet. */
export const HOST_AI_CHECKING_TOOLTIP =
  'Resolving the Host’s model and network path. No action required — this updates automatically.'

export const HOST_AI_STALE_INLINE =
  'That Host model is no longer in the list. Choose another model to continue.'

/** Persisted Host selection can no longer be used (handshake missing, inactive, or after account change). */
export const HOST_INFERENCE_UNAVAILABLE =
  'Your saved Host model is no longer available. Pick another model from the menu.'

/** Visual for Host AI rows in merged selectors (not technical transport text). */
export const HOST_AI_SELECTOR_ICON_CLASS = 'host-ai-model-icon'

export const GROUP_LOCAL_MODELS = 'Local models'
export const GROUP_HOST_MODELS = 'Host models'
/** @deprecated Use GROUP_HOST_MODELS — kept for any stale imports. */
export const GROUP_INTERNAL_HOST = GROUP_HOST_MODELS
export const GROUP_CLOUD = 'Cloud'

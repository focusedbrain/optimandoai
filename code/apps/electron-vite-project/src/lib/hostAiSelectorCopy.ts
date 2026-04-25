/** Tooltips and labels for Host AI in model selectors (orchestrator + WR Chat). */

import type { HostInferenceTargetRow } from '../hooks/useSandboxHostInference'

export const HOST_AI_OPTION_TOOLTIP =
  'Uses the model on your Host — the same idea as choosing a local model, but the model runs on the machine you paired with.'

export const HOST_AI_UNREACHABLE_TOOLTIP =
  'Host AI could not connect. Check that the Host is online, on a reachable path, and that firewalls or VPN allow the connection.'

/**
 * Generic path/transport message — not tied to legacy endpoint inspection in the UI (STEP 7).
 */
export const HOST_AI_PATH_UNAVAILABLE_TOOLTIP = [
  'The Host could not be reached on the current path (network or app state).',
  'Possible causes:',
  '• Host app not running',
  '• relay or firewall blocking the connection',
  '• not on a reachable path from this Sandbox',
].join('\n')

/** @deprecated Use projection / HOST_AI_PATH_UNAVAILABLE_TOOLTIP; kept for test imports if needed. */
export const HOST_AI_P2P_OFFLINE_DETAIL_TOOLTIP = HOST_AI_PATH_UNAVAILABLE_TOOLTIP

/**
 * @deprecated Quarantined — do not surface “MVP endpoint” to users. Prefer `p2pUiPhase` + primaryLabel (STEP 9).
 */
export const HOST_AI_MVP_P2P_ENDPOINT_INVALID_TOOLTIP =
  'Host AI · legacy endpoint unavailable — check pairing in Settings, or use Host AI with WebRTC enabled.'

/** Placeholder while the internal Host handshake is recognized but capabilities are not ready yet. */
export const HOST_AI_CHECKING_TOOLTIP =
  'Resolving the Host’s model and network path. No action required — this updates automatically.'

export const HOST_AI_STALE_INLINE =
  'That Host AI selection is no longer in the list. Choose another model to continue.'

/** Persisted Host selection can no longer be used (handshake missing, inactive, or after account change). */
export const HOST_INFERENCE_UNAVAILABLE =
  'Your saved Host AI selection is no longer valid. Open the model menu and pick Host AI again, or choose a local or cloud model.'

/** Visual for Host AI rows in merged selectors (not technical transport text). */
export const HOST_AI_SELECTOR_ICON_CLASS = 'host-ai-model-icon'

export const GROUP_LOCAL_MODELS = 'Local models'
export const GROUP_HOST_MODELS = 'Host models'
/** @deprecated Use GROUP_HOST_MODELS — kept for any stale imports. */
export const GROUP_INTERNAL_HOST = GROUP_HOST_MODELS
export const GROUP_CLOUD = 'Cloud'

const NL = '\n\n'

const ACT_SANDBOX_REFRESH =
  'Action: use Refresh (↻) next to the model menu to re-check the Host, or ensure the Host app is online on your network.'

const TOOLTIP_DISABLED = [
  'The Host has turned off Sandbox inference in policy.',
  'Action: on the Host machine, open settings for internal / Host AI inference and allow this Sandbox, or ask the person who manages the Host.',
].join(NL)

const TOOLTIP_NO_MODEL = [
  'The Host has no active local Ollama model selected.',
  'Action: on the Host, pick or pull a model in Ollama and set it as the active chat model.',
].join(NL)

const TOOLTIP_ROLE = [
  'Device roles in the handshake do not show Sandbox→Host the way the app expects.',
  'Action: open Settings, verify internal handshake device roles, or re-pair the devices.',
].join(NL)

const TOOLTIP_IDENTITY = [
  'Pairing metadata for this internal handshake is incomplete.',
  'Action: open the handshake in Settings, complete device identity, or re-pair.',
].join(NL)

const TOOLTIP_LEGACY_PATH = [
  'Host AI · legacy endpoint unavailable — the stored path is not valid for this device while WebRTC is off.',
  'Action: re-check pairing in Settings or on the Host, then use Refresh (↻) in the model menu on Sandbox.',
].join(NL)

function phaseFrom(t: HostInferenceTargetRow | null | undefined): string | undefined {
  return t?.p2pUiPhase
}

/**
 * Chat submit when the Host target row is disabled — uses `p2pUiPhase` from main. Do not blame “model” for transport (STEP 9).
 */
export function hostAiChatBlockedUserMessage(t: HostInferenceTargetRow | undefined): string {
  if (!t) {
    return 'Open the model menu and select Host AI when it is ready, or pick a local or cloud model.'
  }
  const ph = t.p2pUiPhase
  if (ph === 'no_model') {
    return 'Host AI · no active model. On the Host, pick an active local model, then try again or choose another model here.'
  }
  if (ph === 'policy_disabled') {
    return 'Host AI · disabled by Host. On the Host, allow Sandbox inference, or pick another model here.'
  }
  if (ph === 'legacy_http_invalid') {
    return 'Host AI · legacy endpoint unavailable. This path is not available with WebRTC off — check Settings or use Refresh (↻), then try again.'
  }
  if (ph === 'connecting' || t.host_selector_state === 'checking' || t.availability === 'checking_host') {
    return 'Host AI is still connecting. Wait a moment, use Refresh (↻) in the model menu, or pick another model.'
  }
  if (ph === 'hidden' || t.unavailable_reason === 'SANDBOX_HOST_ROLE_METADATA') {
    return 'Host AI is not set up for this device pair. Check internal handshake roles in Settings, or pick another model.'
  }
  if (ph === 'p2p_unavailable' || t.availability === 'direct_unreachable' || t.availability === 'host_offline') {
    return 'Host AI · P2P unavailable. Check that the Host app is online, use Refresh (↻), or pick a local or cloud model.'
  }
  if (t.availability === 'model_unavailable' || t.unavailable_reason === 'HOST_NO_ACTIVE_LOCAL_LLM') {
    return 'Host AI · no active model. On the Host, pick an active local model, or choose another model here.'
  }
  if (t.availability === 'policy_disabled' || t.unavailable_reason === 'HOST_POLICY_DISABLED') {
    return 'Host AI · disabled by Host. Change policy on the Host, or pick another model here.'
  }
  return 'Host AI is not available for this run. Open the model menu, or select a local or cloud model.'
}

/**
 * One tooltip string (reason + suggested action). Prefer `p2pUiPhase` and `hostSelectorState` from main (STEP 7).
 */
export function hostAiRowUnavailableTooltip(
  t: HostInferenceTargetRow | null | undefined,
  opts: {
    hostTargetAvailable: boolean
    hostSelectorState?: 'available' | 'checking' | 'unavailable'
  },
): string {
  if (
    opts.hostSelectorState === 'checking' ||
    t?.hostSelectorState === 'checking' ||
    t?.host_selector_state === 'checking' ||
    t?.unavailable_reason === 'CHECKING_CAPABILITIES' ||
    t?.availability === 'checking_host'
  ) {
    return HOST_AI_CHECKING_TOOLTIP
  }
  if (opts.hostTargetAvailable && t?.available !== false) {
    return HOST_AI_OPTION_TOOLTIP
  }
  const ph = phaseFrom(t)
  if (ph === 'policy_disabled') {
    return TOOLTIP_DISABLED
  }
  if (ph === 'no_model') {
    return TOOLTIP_NO_MODEL
  }
  if (ph === 'hidden') {
    return TOOLTIP_ROLE
  }
  if (ph === 'p2p_unavailable' || ph === 'connecting') {
    return `${HOST_AI_PATH_UNAVAILABLE_TOOLTIP}${NL}${ACT_SANDBOX_REFRESH}`
  }
  if (ph === 'legacy_http_invalid') {
    return `${TOOLTIP_LEGACY_PATH}${NL}${ACT_SANDBOX_REFRESH}`
  }
  const ur = String(t?.unavailable_reason ?? '')
  const av = String(t?.availability ?? '')
  if (ur === 'SANDBOX_HOST_ROLE_METADATA') {
    return TOOLTIP_ROLE
  }
  if (t?.availability === 'identity_incomplete' || ur === 'IDENTITY_INCOMPLETE' || av === 'identity_incomplete') {
    return TOOLTIP_IDENTITY
  }
  if (t?.availability === 'policy_disabled' || ur === 'HOST_POLICY_DISABLED' || /disabled\s+by\s+host/i.test(String(t?.display_label ?? t?.label ?? ''))) {
    return TOOLTIP_DISABLED
  }
  if (t?.availability === 'model_unavailable' || ur === 'HOST_NO_ACTIVE_LOCAL_LLM') {
    return TOOLTIP_NO_MODEL
  }
  return `${HOST_AI_PATH_UNAVAILABLE_TOOLTIP}${NL}${ACT_SANDBOX_REFRESH}`
}

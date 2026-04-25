/** Tooltips and labels for Host AI in model selectors (WR Chat / PopupChatView). */

export const HOST_AI_OPTION_TOOLTIP =
  'Uses the model on your Host — the same idea as choosing a local model, but the model runs on the machine you paired with.'

export const HOST_AI_UNREACHABLE_TOOLTIP =
  "Can't reach your Host right now. Check that it's online, on the same network, and that firewalls or VPN allow the connection."

/** Multi-line for `title` (Chromium); dashboard usually passes `hostTooltipDetail` from main. */
export const HOST_AI_P2P_OFFLINE_DETAIL_TOOLTIP = [
  'Host handshake detected',
  'direct P2P failed',
  'possible causes:',
  '• Host app not running',
  '• Host P2P server disabled',
  '• firewall blocks port',
  '• endpoint stale',
  '• not on same LAN',
].join('\n')

export const HOST_AI_CHECKING_TOOLTIP =
  'Resolving the Host’s model and network path. No action required — this updates automatically.'

export const HOST_AI_STALE_INLINE =
  'That Host model is no longer in the list. Choose another model to continue.'

export const GROUP_LOCAL_MODELS = 'Local models'
export const GROUP_HOST_MODELS = 'Host models'
/** @deprecated Use GROUP_HOST_MODELS */
export const GROUP_INTERNAL_HOST = GROUP_HOST_MODELS
export const GROUP_CLOUD = 'Cloud'

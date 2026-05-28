/** User-facing copy for the pair verification server wizard step (PR8). */

export const PAIR_STEP_INTRO =
  'Install the verification server software on your Linux VPS, then enter its address below.'

export const PAIR_INSTALL_CMD = 'curl -fsSL https://wrdesk.com/edge-agent/install.sh | sudo bash'

export const PAIR_STEP_ADDRESS_HELP =
  'HTTPS address of the verification server pairing endpoint (port 8443 by default).'

export const PAIR_STEP_LINK_HELP =
  'Paste the pairing link from your verification server to pre-fill address and code.'

export const PAIR_STEP_CODE_HELP =
  'Six-digit code shown on your verification server (setup screen).'

export const PAIR_STEP_CONFIRM_BODY =
  'Confirm this matches the fingerprint shown on your verification server:'

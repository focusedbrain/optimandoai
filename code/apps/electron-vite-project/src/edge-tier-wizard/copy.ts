/**
 * Wizard copy — Phase 4 (P4.5).
 * Centralized strings for snapshot tests (provider-favoritism guard).
 */

/** Step 2 — illustrative provider list only; alphabetized, no preference order. */
export const STEP2_VM_HELP =
  'Provide any Linux VPS you have root SSH access to.'

/** Step 4 — from strategy §4.1 step 4. */
export const STEP4_REPLICA_HELP =
  'Each replica is an independent edge pod on its own VM. If one is attacked or down, the others keep validating. Most users pick 2.'

export const STEP4_REPLICA_MULTI_NOTE =
  'If you choose more than one replica, you will provide VM credentials and prepare each host separately. Replicas do not need to share a provider or region.'

export const LOCAL_POD_REQUIRED_MESSAGE =
  'This wizard requires Podman on your computer to run the local verification pod. Install Podman Desktop from podman.io, ensure a machine is running (Windows/macOS), then restart the app.'

export const WIZARD_TITLE = 'Set up Edge Ingestor'

/** Wizard upgrade target — Phase 4.5 hard rule (do not share with sandbox/coordination URLs). */
export const WIZARD_UPGRADE_URL = 'https://wrdesk.com/?page_id=1080&v=5f02f0889301'

export const STEP_LABELS = [
  'Overview',
  'Sign in',
  'Provide VM',
  'Probe & prepare',
  'Replica count',
  'Deploy',
  'Verify & enable',
  'Email on edge',
] as const

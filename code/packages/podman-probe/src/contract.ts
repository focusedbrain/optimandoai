/**
 * Cross-surface Podman readiness contract (orchestrator host, edge replica, relay host).
 * All surfaces MUST implement these steps before critical BEAP operations.
 */

export const PODMAN_PROBE_CONTRACT_VERSION = 1 as const

export type PodmanProbeSurface = 'orchestrator_host' | 'edge_replica' | 'relay_host'

export type PodmanProbeFailureCode =
  | 'not_on_path'
  | 'engine_unhealthy'
  | 'machine_not_initialized'
  | 'machine_not_running'
  | 'ingestor_unhealthy'

export type PodmanMachineState = 'not_applicable' | 'none' | 'stopped' | 'running'

/** Ordered steps every surface must satisfy (relay adds ingestor health). */
export const PODMAN_PROBE_CONTRACT_STEPS = [
  'binary_on_path',
  'engine_healthy',
  'machine_running_when_required',
  'ingestor_healthy_relay_only',
] as const

export type PodmanProbeContractStepId = (typeof PODMAN_PROBE_CONTRACT_STEPS)[number]

export interface PodmanProbeInputs {
  surface: PodmanProbeSurface
  /** Host OS when known (desktop/edge). Relay host is always linux in production. */
  platform?: NodeJS.Platform | 'linux' | 'unknown'
  binaryOnPath: boolean
  engineHealthy: boolean
  machineState?: PodmanMachineState
  /** Relay host only — BEAP ingestor /health with role=ingestor */
  ingestorHealthy?: boolean
}

export interface PodmanProbeEvaluation {
  ok: boolean
  failureCode?: PodmanProbeFailureCode
  failedStep?: PodmanProbeContractStepId
  message?: string
}

export function platformRequiresPodmanMachine(
  platform: NodeJS.Platform | 'linux' | 'unknown' | undefined,
): boolean {
  return platform === 'win32' || platform === 'darwin'
}

/**
 * Pure evaluation shared by orchestrator, edge SSH preflight, and relay Node/shell gates.
 */
export function evaluatePodmanProbe(inputs: PodmanProbeInputs): PodmanProbeEvaluation {
  if (!inputs.binaryOnPath) {
    return {
      ok: false,
      failureCode: 'not_on_path',
      failedStep: 'binary_on_path',
      message:
        'Podman is not installed or not on PATH. Install from https://podman.io/docs/installation',
    }
  }

  if (!inputs.engineHealthy) {
    return {
      ok: false,
      failureCode: 'engine_unhealthy',
      failedStep: 'engine_healthy',
      message: 'Podman engine is not healthy (podman info failed).',
    }
  }

  if (platformRequiresPodmanMachine(inputs.platform)) {
    const machine = inputs.machineState ?? 'none'
    if (machine === 'none') {
      return {
        ok: false,
        failureCode: 'machine_not_initialized',
        failedStep: 'machine_running_when_required',
        message:
          'Podman is installed but no virtual machine exists. Run "podman machine init" once, then "podman machine start".',
      }
    }
    if (machine === 'stopped') {
      return {
        ok: false,
        failureCode: 'machine_not_running',
        failedStep: 'machine_running_when_required',
        message:
          'Podman virtual machine is not running. Run "podman machine start" (or start from Podman Desktop).',
      }
    }
  }

  if (inputs.surface === 'relay_host' && inputs.ingestorHealthy === false) {
    return {
      ok: false,
      failureCode: 'ingestor_unhealthy',
      failedStep: 'ingestor_healthy_relay_only',
      message:
        'BEAP ingestor pod is not healthy. Start packages/beap-pod/pod-relay-host.yaml via podman play kube.',
    }
  }

  return { ok: true }
}

/** Remote edge replica (Linux): shell probe command — must stay aligned with contract steps 1–2. */
export function buildRemoteLinuxPodmanPreflightShell(
  podmanBin = 'podman',
): string {
  return (
    `command -v ${podmanBin} >/dev/null 2>&1 && ` +
    `${podmanBin} info >/dev/null 2>&1`
  )
}

/** Parse remote preflight shell exit — maps to contract evaluation inputs. */
export function evaluateRemoteLinuxPodmanPreflightResult(opts: {
  whichExitCode: number | null
  infoExitCode: number | null
}): PodmanProbeEvaluation {
  return evaluatePodmanProbe({
    surface: 'edge_replica',
    platform: 'linux',
    binaryOnPath: opts.whichExitCode === 0,
    engineHealthy: opts.infoExitCode === 0,
    machineState: 'not_applicable',
  })
}

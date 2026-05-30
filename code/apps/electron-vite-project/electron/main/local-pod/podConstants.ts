/** Leaf module — pod names and shared timing constants (no local-pod imports). */

export const DEFAULT_POD_NAME = 'beap-pod'
export const DEFAULT_LOCAL_VERIFY_POD_NAME = 'beap-pod-local-verify'

export const LOCAL_POD_HEALTH_PROBE_TIMEOUT_MS = 3_000

/** Podman/OCI exec-layer failures — not HTTP /health unhealthy (e.g. concurrent exec flake). */
export const LOCAL_POD_EXEC_LAYER_EXIT_CODES = new Set([125, 126, 127])

/** Consecutive genuine failures before a container is treated as unhealthy (steady-state gate). */
export const LOCAL_POD_GENUINE_HEALTH_FAILURE_THRESHOLD = 3

/** Retries for exec probe when the failure looks like an exec-layer flake. */
export const LOCAL_POD_HEALTH_EXEC_RETRIES = 2

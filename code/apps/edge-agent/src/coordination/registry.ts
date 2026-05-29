/**
 * Coordination registry client — same API as orchestrator sandbox registration.
 * @see packages/coordination-service POST /api/coordination/register-pairing-code
 */

export type RegisterPairingCodeResult = 'inserted' | 'idempotent' | 'collision' | 'unavailable'

export interface RegisterPairingCodeParams {
  readonly coordinationUrl: string
  readonly accessToken: string
  readonly userId: string
  readonly instanceId: string
  readonly pairingCode: string
  readonly deviceName: string
  readonly timeoutMs?: number
}

export async function registerPairingCode(
  params: RegisterPairingCodeParams,
): Promise<RegisterPairingCodeResult> {
  const base = params.coordinationUrl.replace(/\/$/, '')
  const url = `${base}/api/coordination/register-pairing-code`
  const timeoutMs = params.timeoutMs ?? 8000

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      },
      body: JSON.stringify({
        user_id: params.userId,
        instance_id: params.instanceId,
        pairing_code: params.pairingCode,
        device_name: params.deviceName,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    return 'unavailable'
  }

  if (res.status === 201) return 'inserted'
  if (res.status === 200) return 'idempotent'
  if (res.status === 409) return 'collision'
  return 'unavailable'
}

const MAX_REGISTRATION_ATTEMPTS = 5

export interface EnsureRegistryRegisteredDeps {
  readonly coordinationUrl: string
  readonly getAccessToken: () => Promise<string | null>
  readonly getUserId: () => Promise<string | null>
  readonly getIdentity: () => Promise<{ instanceId: string; deviceName: string; registryPairingCode: string }>
  readonly rotatePairingCode: () => Promise<string>
  readonly register: (pairingCode: string) => Promise<RegisterPairingCodeResult>
}

let lastConfirmedCode: string | null = null

/** Reset in tests only. */
export function resetRegistryRegistrationCacheForTests(): void {
  lastConfirmedCode = null
}

/**
 * Ensure the device’s registry code is registered (idempotent). On collision, rotate and retry.
 */
export async function ensureRegistryPairingCodeRegistered(
  deps: EnsureRegistryRegisteredDeps,
): Promise<{ code: string; status: RegisterPairingCodeResult }> {
  const identity = await deps.getIdentity()
  let current = identity.registryPairingCode

  if (current === lastConfirmedCode) {
    return { code: current, status: 'idempotent' }
  }

  const token = await deps.getAccessToken()
  const userId = await deps.getUserId()
  if (!token?.trim() || !userId?.trim() || !deps.coordinationUrl?.trim()) {
    return { code: current, status: 'unavailable' }
  }

  for (let attempt = 0; attempt < MAX_REGISTRATION_ATTEMPTS; attempt += 1) {
    const result = await deps.register(current)
    if (result === 'inserted' || result === 'idempotent') {
      lastConfirmedCode = current
      return { code: current, status: result }
    }
    if (result === 'unavailable') {
      return { code: current, status: result }
    }
    current = await deps.rotatePairingCode()
    lastConfirmedCode = null
  }

  return { code: current, status: 'collision' }
}

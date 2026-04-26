/**
 * Circuit breaker for Host AI **relay signaling only** (POST /beap/p2p-signal).
 * After repeated 429 exhaustion on offer/answer in a short window, pause **new** P2P session
 * ensures so we do not hammer the relay; unrelated HTTP traffic is unaffected.
 */

const STORM_WINDOW_MS = 60_000
const STORMS_TO_OPEN = 3
const PAUSE_MS = 30_000

const stormTimestamps: number[] = []
let circuitOpenUntilMs = 0

function pruneStorms(now: number): void {
  while (stormTimestamps.length > 0 && stormTimestamps[0] < now - STORM_WINDOW_MS) {
    stormTimestamps.shift()
  }
}

/**
 * Record one "429 storm" — offer or answer exhausted in-message 429 retries (session-level failure).
 */
export function recordP2pRelaySignaling429Storm(): void {
  const now = Date.now()
  pruneStorms(now)
  stormTimestamps.push(now)
  pruneStorms(now)
  if (stormTimestamps.length >= STORMS_TO_OPEN) {
    circuitOpenUntilMs = now + PAUSE_MS
    stormTimestamps.length = 0
    console.log(
      `[P2P_SIGNAL_CIRCUIT] open pause_ms=${PAUSE_MS} until_epoch_ms=${circuitOpenUntilMs} reason=relay_429_offer_answer_storms storms_in_${STORM_WINDOW_MS / 1000}s=${STORMS_TO_OPEN}`,
    )
  }
}

export function isP2pRelaySignalingCircuitOpen(): boolean {
  const now = Date.now()
  if (now >= circuitOpenUntilMs) {
    return false
  }
  return true
}

export function getP2pRelaySignalingCircuitOpenUntilMs(): number {
  return circuitOpenUntilMs
}

/** @internal Vitest */
export function resetP2pRelaySignalingCircuitForTests(): void {
  stormTimestamps.length = 0
  circuitOpenUntilMs = 0
}

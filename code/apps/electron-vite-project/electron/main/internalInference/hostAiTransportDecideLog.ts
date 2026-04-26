/**
 * De-dupe `[HOST_AI_TRANSPORT_DECIDE]` when list targets runs twice in the same second with the same
 * transport outcome but different correlation chains (Part E reduces duplicates; this guards the log line).
 */

const fingerprintByHandshakeSecond = new Map<string, string>()

function pruneTransportDecideDedupe(nowSec: number): void {
  if (fingerprintByHandshakeSecond.size < 400) return
  for (const k of fingerprintByHandshakeSecond.keys()) {
    const parts = k.split('|')
    const secPart = parts[1]
    const sec = secPart != null ? parseInt(secPart, 10) : NaN
    if (!Number.isFinite(sec) || nowSec - sec > 3) {
      fingerprintByHandshakeSecond.delete(k)
    }
  }
}

/** Call on orchestrator build bump so the next list pass can log a fresh decide line. */
export function clearHostAiTransportDecideDedupeCache(): void {
  fingerprintByHandshakeSecond.clear()
}

/** @internal Vitest */
export const resetHostAiTransportDecideDedupeForTests = clearHostAiTransportDecideDedupeCache

/**
 * Log one list-path `[HOST_AI_TRANSPORT_DECIDE]` per handshake per second per decision fingerprint
 * (chain and BEAP correlation id are omitted from the fingerprint intentionally).
 */
export function logHostAiTransportDecideListLine(args: {
  handshakeId: string
  line: string
  /** Stable outcome key — no correlation chain. */
  decisionFingerprint: string
}): void {
  const hid = args.handshakeId.trim()
  const sec = Math.floor(Date.now() / 1000)
  const key = `${hid}|${sec}`
  if (fingerprintByHandshakeSecond.get(key) === args.decisionFingerprint) {
    return
  }
  fingerprintByHandshakeSecond.set(key, args.decisionFingerprint)
  pruneTransportDecideDedupe(sec)
  console.log(args.line)
}

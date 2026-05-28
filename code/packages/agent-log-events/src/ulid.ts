import { randomBytes } from 'node:crypto'

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** Monotonic ULID (26 Crockford chars) for event_id ordering across restarts. */
let lastMs = 0
let lastRandom: Buffer = Buffer.alloc(10, 0)

export function newAgentLogEventId(nowMs: number = Date.now()): string {
  if (nowMs === lastMs) {
    incrementRandom(lastRandom)
  } else if (nowMs > lastMs) {
    lastMs = nowMs
    lastRandom = randomBytes(10)
  } else {
    lastMs = nowMs
    incrementRandom(lastRandom)
  }

  const timeChars = encodeTime(lastMs, 10)
  const randChars = encodeBuffer(lastRandom, 16)
  return timeChars + randChars
}

export function resetUlidStateForTests(): void {
  lastMs = 0
  lastRandom = Buffer.alloc(10, 0)
}

function incrementRandom(buf: Buffer): void {
  for (let i = buf.length - 1; i >= 0; i--) {
    buf[i] = (buf[i]! + 1) & 0xff
    if (buf[i] !== 0) return
  }
}

function encodeTime(ms: number, len: number): string {
  let out = ''
  let t = ms
  for (let i = 0; i < len; i++) {
    out = ENCODING[t % 32]! + out
    t = Math.floor(t / 32)
  }
  return out
}

function encodeBuffer(buf: Buffer, len: number): string {
  let out = ''
  let value = 0
  let bits = 0
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i]!
    bits += 8
    while (bits >= 5) {
      bits -= 5
      out += ENCODING[(value >> bits) & 31]!
    }
  }
  if (bits > 0) {
    out += ENCODING[(value << (5 - bits)) & 31]!
  }
  return out.padEnd(len, '0').slice(0, len)
}

/** Compare ULIDs lexicographically (time-ordered). */
export function compareAgentLogEventIds(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

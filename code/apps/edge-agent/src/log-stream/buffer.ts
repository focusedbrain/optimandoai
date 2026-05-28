import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto'
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  compareAgentLogEventIds,
  parseAgentLogEventLine,
  type AgentLogEvent,
} from '@repo/agent-log-events'

import { deriveAgentLogBufferKey } from './deriveKey.js'

const ALGO = 'aes-256-gcm'
const MAX_EVENTS = 5000
const MAX_BYTES = 50 * 1024 * 1024

export interface AgentLogBufferSize {
  count: number
  bytes: number
  oldestId: string | null
  newestId: string | null
}

interface BufferMeta {
  ackThroughId: string | null
  totalBytes: number
}

export class AgentLogRingBuffer {
  private readonly eventsPath: string
  private readonly metaPath: string
  private key: Buffer | null = null
  private meta: BufferMeta = { ackThroughId: null, totalBytes: 0 }
  private eventCount = 0
  private loaded = false

  constructor(readonly stateDir: string) {
    const dir = join(stateDir, 'log-buffer')
    this.eventsPath = join(dir, 'events.enc.jsonl')
    this.metaPath = join(dir, 'meta.enc')
  }

  private async ensureKey(): Promise<Buffer> {
    if (!this.key) this.key = await deriveAgentLogBufferKey(this.stateDir)
    return this.key
  }

  private async encryptLine(plain: string): Promise<string> {
    const key = await this.ensureKey()
    const iv = randomBytes(12)
    const cipher = createCipheriv(ALGO, key, iv)
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return Buffer.concat([iv, tag, enc]).toString('base64') + '\n'
  }

  private async decryptLine(line: string): Promise<string | null> {
    try {
      const key = await this.ensureKey()
      const raw = Buffer.from(line.trim(), 'base64')
      if (raw.length < 28) return null
      const iv = raw.subarray(0, 12)
      const tag = raw.subarray(12, 28)
      const data = raw.subarray(28)
      const decipher = createDecipheriv(ALGO, key, iv)
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
    } catch {
      return null
    }
  }

  private async loadMeta(): Promise<void> {
    if (this.loaded) return
    await mkdir(join(this.stateDir, 'log-buffer'), { recursive: true, mode: 0o700 })
    try {
      const enc = await readFile(this.metaPath)
      const key = await this.ensureKey()
      const iv = enc.subarray(0, 12)
      const tag = enc.subarray(12, 28)
      const data = enc.subarray(28)
      const decipher = createDecipheriv(ALGO, key, iv)
      decipher.setAuthTag(tag)
      const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
      this.meta = JSON.parse(plain) as BufferMeta
    } catch {
      this.meta = { ackThroughId: null, totalBytes: 0 }
    }
    this.loaded = true
  }

  private async saveMeta(): Promise<void> {
    const key = await this.ensureKey()
    const iv = randomBytes(12)
    const cipher = createCipheriv(ALGO, key, iv)
    const enc = Buffer.concat([
      cipher.update(JSON.stringify(this.meta), 'utf8'),
      cipher.final(),
    ])
    const tag = cipher.getAuthTag()
    await writeFile(this.metaPath, Buffer.concat([iv, tag, enc]), { mode: 0o600 })
  }

  private async readAllEvents(): Promise<AgentLogEvent[]> {
    await this.loadMeta()
    let raw = ''
    try {
      raw = await readFile(this.eventsPath, 'utf8')
    } catch {
      return []
    }
    const lines = raw.split('\n').filter((l) => l.trim().length > 0)
    const events: AgentLogEvent[] = []
    for (const line of lines) {
      const plain = await this.decryptLine(line)
      if (!plain) continue
      const ev = parseAgentLogEventLine(plain)
      if (ev) events.push(ev)
    }
    events.sort((a, b) => compareAgentLogEventIds(a.event_id, b.event_id))
    this.eventCount = events.length
    this.meta.totalBytes = Buffer.byteLength(raw, 'utf8')
    return events
  }

  async appendEvent(event: AgentLogEvent): Promise<void> {
    await this.loadMeta()
    await mkdir(join(this.stateDir, 'log-buffer'), { recursive: true, mode: 0o700 })
    const line = await this.encryptLine(JSON.stringify(event))
    await appendFile(this.eventsPath, line, { mode: 0o600 })
    this.eventCount += 1
    this.meta.totalBytes += Buffer.byteLength(line, 'utf8')

    if (this.eventCount > MAX_EVENTS || this.meta.totalBytes > MAX_BYTES) {
      await this.evictOldestOverflow()
    }
  }

  private async evictOldestOverflow(): Promise<void> {
    const events = await this.readAllEvents()
    const drop = Math.max(1, events.length - MAX_EVENTS + 1)
    const kept = events.slice(drop)
    await this.rewriteEvents(kept)
    this.eventCount = kept.length
  }

  private async rewriteEvents(events: AgentLogEvent[]): Promise<void> {
    const tmp = `${this.eventsPath}.tmp`
    let bytes = 0
    const lines: string[] = []
    for (const ev of events) {
      const line = await this.encryptLine(JSON.stringify(ev))
      lines.push(line)
      bytes += Buffer.byteLength(line, 'utf8')
    }
    await writeFile(tmp, lines.join(''), { mode: 0o600 })
    await rename(tmp, this.eventsPath)
    this.meta.totalBytes = bytes
    await this.saveMeta()
  }

  async peekEvents(maxCount: number, afterEventId: string | null): Promise<AgentLogEvent[]> {
    const events = await this.readAllEvents()
    const pending = events.filter((ev) => {
      if (afterEventId && compareAgentLogEventIds(ev.event_id, afterEventId) <= 0) {
        return false
      }
      return true
    })
    return pending.slice(0, maxCount)
  }

  async acknowledgeEvents(throughEventId: string): Promise<void> {
    await this.loadMeta()
    const events = await this.readAllEvents()
    const keep = events.filter(
      (ev) => compareAgentLogEventIds(ev.event_id, throughEventId) > 0,
    )
    if (keep.length < events.length) {
      await this.rewriteEvents(keep)
      this.eventCount = keep.length
    }
    this.meta.ackThroughId = throughEventId
    await this.saveMeta()
  }

  async currentSize(): Promise<AgentLogBufferSize> {
    const events = await this.readAllEvents()
    return {
      count: events.length,
      bytes: this.meta.totalBytes,
      oldestId: events[0]?.event_id ?? null,
      newestId: events[events.length - 1]?.event_id ?? null,
    }
  }

  /** Test hook: recover from truncated trailing line. */
  async recoverPartialTrailingLine(): Promise<void> {
    let raw = ''
    try {
      raw = await readFile(this.eventsPath, 'utf8')
    } catch {
      return
    }
    const lines = raw.split('\n')
    if (lines.length === 0) return
    const last = lines[lines.length - 1]
    if (!last?.trim()) return
    const plain = await this.decryptLine(last)
    if (!plain) {
      const trimmed = lines.slice(0, -1).join('\n')
      const suffix = trimmed.length > 0 ? '\n' : ''
      await writeFile(this.eventsPath, trimmed + suffix, { mode: 0o600 })
    }
  }
}

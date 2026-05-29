/**
 * Encrypted hold queue — opaque message blobs while edge tier is Blocked.
 *
 * Held messages are never parsed or depackaged. Encrypted at rest with vault-derived key.
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { app } from 'electron'

import { getHoldQueueVaultBridge } from './holdQueueVaultBridge.js'
import type { HoldQueueVault } from './holdQueueVaultBridge.js'
import type { SourceType, TransportMetadata } from './types.js'

export type { HoldQueueVault } from './holdQueueVaultBridge.js'

export const HOLD_QUEUE_MAX_MESSAGES = 1000
export const HOLD_QUEUE_MAX_BYTES = 500 * 1024 * 1024
export const HOLD_QUEUE_WARN_RATIO = 0.8

export const HOLD_QUEUE_KEY_INFO = 'ingestion-hold-queue-v1'

export interface QueuedMessage {
  id: string
  receivedAt: number
  sourceType: SourceType
  transportMeta: TransportMetadata
  opaqueBody: Uint8Array
}

export interface QueuedMessageMetadata {
  id: string
  receivedAt: number
  sourceType: SourceType
  byteLength: number
}

export interface DrainResult {
  processed: number
  returnedToHeld: number
  errors: number
}

interface StoredEntry {
  id: string
  receivedAt: number
  sourceType: SourceType
  transportMeta: TransportMetadata
  /** base64(iv || ciphertext || tag) */
  ciphertext_b64: string
  byteLength: number
}

interface HoldQueueFile {
  version: 1
  entries: StoredEntry[]
}

let _pathOverride: string | null = null
let _vaultOverride: HoldQueueVault | null = null
let _warnCallback: ((stats: { count: number; bytes: number; ratio: number }) => void) | null = null
let _limitsOverride: { maxMessages: number; maxBytes: number } | null = null

function maxMessagesLimit(): number {
  return _limitsOverride?.maxMessages ?? HOLD_QUEUE_MAX_MESSAGES
}

function maxBytesLimit(): number {
  return _limitsOverride?.maxBytes ?? HOLD_QUEUE_MAX_BYTES
}

export function _setHoldQueuePathForTest(path: string | null): void {
  _pathOverride = path
}

export function _setHoldQueueVaultForTest(vault: HoldQueueVault | null): void {
  _vaultOverride = vault
}

export function onHoldQueueCapacityWarning(
  cb: ((stats: { count: number; bytes: number; ratio: number }) => void) | null,
): void {
  _warnCallback = cb
}

/** Tests only — use smaller caps for deterministic eviction tests. */
export function _setHoldQueueLimitsForTest(
  limits: { maxMessages?: number; maxBytes?: number } | null,
): void {
  if (!limits) {
    _limitsOverride = null
    return
  }
  _limitsOverride = {
    maxMessages: limits.maxMessages ?? HOLD_QUEUE_MAX_MESSAGES,
    maxBytes: limits.maxBytes ?? HOLD_QUEUE_MAX_BYTES,
  }
}

function getUserDataDir(): string {
  if (process.env['WR_DESK_USER_DATA']) return process.env['WR_DESK_USER_DATA']
  try {
    return app.getPath('userData')
  } catch {
    return join(homedir(), '.config', 'wr-desk')
  }
}

function getQueuePath(): string {
  if (_pathOverride) return _pathOverride
  return join(getUserDataDir(), 'ingestion-hold-queue.json')
}

function getVault(): HoldQueueVault {
  if (_vaultOverride) return _vaultOverride
  return getHoldQueueVaultBridge()
}

function deriveQueueKey(vault: HoldQueueVault): Buffer {
  const key = vault.deriveApplicationKey(HOLD_QUEUE_KEY_INFO)
  if (!key || key.length < 32) {
    throw new Error('Vault is locked — cannot access hold queue')
  }
  return key.subarray(0, 32)
}

function encryptBlob(plain: Uint8Array, vault: HoldQueueVault): string {
  const key = deriveQueueKey(vault)
  try {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const encrypted = Buffer.concat([cipher.update(Buffer.from(plain)), cipher.final()])
    const tag = cipher.getAuthTag()
    return Buffer.concat([iv, encrypted, tag]).toString('base64')
  } finally {
    key.fill(0)
  }
}

function decryptBlob(ciphertextB64: string, vault: HoldQueueVault): Uint8Array {
  const key = deriveQueueKey(vault)
  try {
    const buf = Buffer.from(ciphertextB64, 'base64')
    const iv = buf.subarray(0, 12)
    const tag = buf.subarray(buf.length - 16)
    const encrypted = buf.subarray(12, buf.length - 16)
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return new Uint8Array(Buffer.concat([decipher.update(encrypted), decipher.final()]))
  } finally {
    key.fill(0)
  }
}

function loadFile(): HoldQueueFile {
  const path = getQueuePath()
  if (!existsSync(path)) return { version: 1, entries: [] }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as HoldQueueFile
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      return { version: 1, entries: [] }
    }
    return parsed
  } catch {
    return { version: 1, entries: [] }
  }
}

function saveFile(file: HoldQueueFile): void {
  const path = getQueuePath()
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(file), { mode: 0o600 })
  renameSync(tmp, path)
}

function totalBytes(entries: StoredEntry[]): number {
  return entries.reduce((sum, e) => sum + e.byteLength, 0)
}

function maybeWarnCapacity(count: number, bytes: number): void {
  const countRatio = count / maxMessagesLimit()
  const byteRatio = bytes / maxBytesLimit()
  const ratio = Math.max(countRatio, byteRatio)
  if (ratio >= HOLD_QUEUE_WARN_RATIO) {
    _warnCallback?.({ count, bytes, ratio })
  }
}

function evictToLimits(entries: StoredEntry[]): StoredEntry[] {
  let next = [...entries].sort((a, b) => a.receivedAt - b.receivedAt)
  while (next.length > maxMessagesLimit()) {
    next = next.slice(1)
  }
  while (totalBytes(next) > maxBytesLimit() && next.length > 0) {
    next = next.slice(1)
  }
  return next
}

export function generateHoldMessageId(): string {
  const t = Date.now().toString(36)
  const r = randomBytes(8).toString('hex')
  return `hold-${t}-${r}`
}

export async function holdQueueEnqueue(msg: QueuedMessage): Promise<void> {
  const vault = getVault()
  const file = loadFile()
  const ciphertext_b64 = encryptBlob(msg.opaqueBody, vault)
  file.entries.push({
    id: msg.id,
    receivedAt: msg.receivedAt,
    sourceType: msg.sourceType,
    transportMeta: msg.transportMeta,
    ciphertext_b64,
    byteLength: msg.opaqueBody.byteLength,
  })

  if (file.entries.length > maxMessagesLimit() || totalBytes(file.entries) > maxBytesLimit()) {
    file.entries = evictToLimits(file.entries)
  }

  saveFile(file)
  maybeWarnCapacity(file.entries.length, totalBytes(file.entries))
}

export async function holdQueueSize(): Promise<{ count: number; bytes: number }> {
  const file = loadFile()
  return { count: file.entries.length, bytes: totalBytes(file.entries) }
}

export async function holdQueuePeek(limit: number): Promise<QueuedMessageMetadata[]> {
  const file = loadFile()
  return file.entries.slice(0, limit).map((e) => ({
    id: e.id,
    receivedAt: e.receivedAt,
    sourceType: e.sourceType,
    byteLength: e.byteLength,
  }))
}

export async function holdQueueEvictOldest(n: number): Promise<number> {
  if (n <= 0) return 0
  const file = loadFile()
  const before = file.entries.length
  file.entries = [...file.entries]
    .sort((a, b) => a.receivedAt - b.receivedAt)
    .slice(n)
  const evicted = before - file.entries.length
  if (evicted > 0) saveFile(file)
  return evicted
}

function entryToMessage(entry: StoredEntry, vault: HoldQueueVault): QueuedMessage {
  return {
    id: entry.id,
    receivedAt: entry.receivedAt,
    sourceType: entry.sourceType,
    transportMeta: entry.transportMeta,
    opaqueBody: decryptBlob(entry.ciphertext_b64, vault),
  }
}

export type DrainShouldContinue = () => boolean

export async function holdQueueDrainTo(
  handler: (msg: QueuedMessage) => Promise<void>,
  shouldContinue: DrainShouldContinue = () => true,
): Promise<DrainResult> {
  const vault = getVault()
  const file = loadFile()
  const remaining: StoredEntry[] = []
  let processed = 0
  let errors = 0
  let returnedToHeld = 0

  for (const entry of file.entries) {
    if (!shouldContinue()) {
      remaining.push(entry)
      returnedToHeld++
      continue
    }
    try {
      const msg = entryToMessage(entry, vault)
      await handler(msg)
      processed++
    } catch {
      remaining.push(entry)
      errors++
      returnedToHeld++
    }
  }

  saveFile({ version: 1, entries: remaining })
  return { processed, returnedToHeld, errors }
}

/** Serialize raw input + metadata to opaque bytes (no parsing). */
export function serializeOpaqueHoldPayload(
  rawBody: string | Buffer,
  sourceType: SourceType,
  transportMeta: TransportMetadata,
  depackageKeys?: unknown,
): Uint8Array {
  const envelope = {
    v: 1,
    body_b64: Buffer.isBuffer(rawBody) ? rawBody.toString('base64') : Buffer.from(rawBody, 'utf8').toString('base64'),
    sourceType,
    transportMeta,
    depackageKeys: depackageKeys ?? null,
  }
  return new TextEncoder().encode(JSON.stringify(envelope))
}

export function deserializeOpaqueHoldPayload(opaque: Uint8Array): {
  rawBody: string
  sourceType: SourceType
  transportMeta: TransportMetadata
  depackageKeys?: unknown
} {
  const parsed = JSON.parse(new TextDecoder().decode(opaque)) as {
    body_b64: string
    sourceType: SourceType
    transportMeta: TransportMetadata
    depackageKeys?: unknown
  }
  return {
    rawBody: Buffer.from(parsed.body_b64, 'base64').toString('utf8'),
    sourceType: parsed.sourceType,
    transportMeta: parsed.transportMeta ?? {},
    depackageKeys: parsed.depackageKeys ?? undefined,
  }
}

export function opaqueHoldPayloadHash(opaque: Uint8Array): string {
  return createHash('sha256').update(opaque).digest('hex').slice(0, 16)
}

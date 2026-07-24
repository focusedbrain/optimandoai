/**
 * llama-server spawn argument resolution (build039).
 *
 * - Builds explicit args (-ngl, --jinja, --ctx-size, --parallel, --flash-attn,
 *   --reasoning-budget) from the persisted {@link LocalLlmServerConfig}.
 * - Verifies every managed flag against the installed binary's `--help` output
 *   before spawn: releases shift flags, and an unknown flag makes llama-server
 *   exit, which would put supervision into a restart loop. Unsupported flags are
 *   omitted with a `[LOCAL_LLM_SPAWN] flag_unsupported=<flag>` log.
 * - VRAM budgeting plans **per-slot** context (build039): presets are per-slot
 *   values; `--ctx-size` = per_slot × parallel. KV is costed as parallel ×
 *   per_slot × kv_bytes/token (kv_unified=false worst case).
 */

import fs from 'fs'
import { exec } from 'child_process'
import { promisify } from 'util'
import {
  LOCAL_LLM_CTX_LONG,
  LOCAL_LLM_CTX_STANDARD,
  type LocalLlmServerConfig,
} from './localLlmServerConfig'

const execAsync = promisify(exec)

// ── GGUF metadata → KV bytes per token ──────────────────────────────────────

export interface GgufKvEstimate {
  /** Bytes of KV cache per context token (K + V, f16). */
  kvBytesPerToken: number
  /** 'gguf' when read from the model header; 'fallback' when parsing failed. */
  source: 'gguf' | 'fallback'
  blockCount?: number
  kvHeadCount?: number
  headDim?: number
  /** Model's trained context length when present (upper bound for ctx). */
  trainedCtx?: number
}

/**
 * Conservative fallback when GGUF metadata is unreadable: 48 layers × 8 KV heads
 * × 128 head dim × 2 (K+V) × 2 bytes (f16) ≈ 192 KiB/token — sized on current
 * ~12B-class models so a bad parse under-provisions rather than over-provisions.
 */
export const FALLBACK_KV_BYTES_PER_TOKEN = 2 * 48 * 8 * 128 * 2

const GGUF_MAGIC = 0x46554747 // 'GGUF' little-endian
/** Metadata keys of interest normally sit in the first few KB; 32 MiB covers pathological orderings. */
const GGUF_READ_BYTES = 32 * 1024 * 1024

class GgufCursor {
  constructor(
    public buf: Buffer,
    public off = 0,
  ) {}

  need(n: number): void {
    if (this.off + n > this.buf.length) throw new Error('gguf_buffer_exhausted')
  }

  u32(): number {
    this.need(4)
    const v = this.buf.readUInt32LE(this.off)
    this.off += 4
    return v
  }

  u64(): number {
    this.need(8)
    const v = this.buf.readBigUInt64LE(this.off)
    this.off += 8
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('gguf_u64_overflow')
    return Number(v)
  }

  i64(): number {
    this.need(8)
    const v = this.buf.readBigInt64LE(this.off)
    this.off += 8
    return Number(v)
  }

  str(): string {
    const len = this.u64()
    this.need(len)
    const s = this.buf.toString('utf8', this.off, this.off + len)
    this.off += len
    return s
  }

  skip(n: number): void {
    this.need(n)
    this.off += n
  }
}

/** GGUF value type ids per spec. */
const enum GgufType {
  UINT8 = 0,
  INT8 = 1,
  UINT16 = 2,
  INT16 = 3,
  UINT32 = 4,
  INT32 = 5,
  FLOAT32 = 6,
  BOOL = 7,
  STRING = 8,
  ARRAY = 9,
  UINT64 = 10,
  INT64 = 11,
  FLOAT64 = 12,
}

function readScalar(cur: GgufCursor, type: number): number | string | boolean {
  switch (type) {
    case GgufType.UINT8:
    case GgufType.INT8:
      cur.need(1)
      return cur.buf.readUInt8(cur.off++)
    case GgufType.UINT16:
    case GgufType.INT16: {
      cur.need(2)
      const v = cur.buf.readUInt16LE(cur.off)
      cur.off += 2
      return v
    }
    case GgufType.UINT32:
      return cur.u32()
    case GgufType.INT32: {
      cur.need(4)
      const v = cur.buf.readInt32LE(cur.off)
      cur.off += 4
      return v
    }
    case GgufType.FLOAT32: {
      cur.need(4)
      const v = cur.buf.readFloatLE(cur.off)
      cur.off += 4
      return v
    }
    case GgufType.BOOL:
      cur.need(1)
      return cur.buf.readUInt8(cur.off++) !== 0
    case GgufType.STRING:
      return cur.str()
    case GgufType.UINT64:
      return cur.u64()
    case GgufType.INT64:
      return cur.i64()
    case GgufType.FLOAT64: {
      cur.need(8)
      const v = cur.buf.readDoubleLE(cur.off)
      cur.off += 8
      return v
    }
    default:
      throw new Error(`gguf_unknown_type_${type}`)
  }
}

function skipValue(cur: GgufCursor, type: number): void {
  if (type === GgufType.ARRAY) {
    const elemType = cur.u32()
    const count = cur.u64()
    if (elemType === GgufType.STRING || elemType === GgufType.ARRAY) {
      for (let i = 0; i < count; i++) skipValue(cur, elemType)
      return
    }
    const sizes: Record<number, number> = {
      [GgufType.UINT8]: 1,
      [GgufType.INT8]: 1,
      [GgufType.BOOL]: 1,
      [GgufType.UINT16]: 2,
      [GgufType.INT16]: 2,
      [GgufType.UINT32]: 4,
      [GgufType.INT32]: 4,
      [GgufType.FLOAT32]: 4,
      [GgufType.UINT64]: 8,
      [GgufType.INT64]: 8,
      [GgufType.FLOAT64]: 8,
    }
    const sz = sizes[elemType]
    if (!sz) throw new Error(`gguf_unknown_array_elem_${elemType}`)
    cur.skip(count * sz)
    return
  }
  readScalar(cur, type)
}

/**
 * Parse the GGUF header for the architecture keys needed to estimate KV size.
 * Returns null when the file is not GGUF or the needed keys can't be reached
 * within the read window.
 */
export function parseGgufKvMetadata(buf: Buffer): {
  architecture?: string
  blockCount?: number
  embeddingLength?: number
  headCount?: number
  headCountKv?: number
  contextLength?: number
} | null {
  try {
    const cur = new GgufCursor(buf)
    if (cur.u32() !== GGUF_MAGIC) return null
    const version = cur.u32()
    if (version < 2 || version > 3) return null
    cur.u64() // tensor count
    const kvCount = cur.u64()

    let architecture: string | undefined
    const found: Record<string, number> = {}
    const wanted = ['block_count', 'embedding_length', 'attention.head_count', 'attention.head_count_kv', 'context_length']

    for (let i = 0; i < kvCount; i++) {
      const key = cur.str()
      const type = cur.u32()
      if (key === 'general.architecture' && type === GgufType.STRING) {
        architecture = String(readScalar(cur, type))
        continue
      }
      const suffix = wanted.find((w) => key.endsWith(`.${w}`) || key === w)
      if (suffix && type !== GgufType.ARRAY && type !== GgufType.STRING) {
        const v = readScalar(cur, type)
        if (typeof v === 'number' && Number.isFinite(v)) found[suffix] = v
      } else {
        skipValue(cur, type)
      }
      const haveAll =
        architecture !== undefined &&
        found['block_count'] !== undefined &&
        found['embedding_length'] !== undefined &&
        found['attention.head_count'] !== undefined &&
        found['attention.head_count_kv'] !== undefined &&
        found['context_length'] !== undefined
      if (haveAll) break
    }

    return {
      architecture,
      blockCount: found['block_count'],
      embeddingLength: found['embedding_length'],
      headCount: found['attention.head_count'],
      headCountKv: found['attention.head_count_kv'],
      contextLength: found['context_length'],
    }
  } catch {
    return null
  }
}

/** Estimate KV cache bytes/token from GGUF metadata (f16 K+V), with a safe fallback. */
export function estimateKvBytesPerTokenFromGgufBuffer(buf: Buffer): GgufKvEstimate {
  const meta = parseGgufKvMetadata(buf)
  const blockCount = meta?.blockCount
  const embeddingLength = meta?.embeddingLength
  const headCount = meta?.headCount
  const headCountKv = meta?.headCountKv ?? headCount
  if (
    blockCount &&
    embeddingLength &&
    headCount &&
    headCountKv &&
    blockCount > 0 &&
    embeddingLength > 0 &&
    headCount > 0 &&
    headCountKv > 0
  ) {
    const headDim = Math.floor(embeddingLength / headCount)
    // K + V, f16 (2 bytes) per element, per layer.
    const kvBytesPerToken = 2 * blockCount * headCountKv * headDim * 2
    return {
      kvBytesPerToken,
      source: 'gguf',
      blockCount,
      kvHeadCount: headCountKv,
      headDim,
      trainedCtx: meta?.contextLength,
    }
  }
  return { kvBytesPerToken: FALLBACK_KV_BYTES_PER_TOKEN, source: 'fallback' }
}

/** Read the head of a GGUF file and estimate KV bytes/token. */
export function estimateKvBytesPerTokenFromGgufFile(ggufPath: string): GgufKvEstimate {
  try {
    const fd = fs.openSync(ggufPath, 'r')
    try {
      const size = fs.fstatSync(fd).size
      const len = Math.min(size, GGUF_READ_BYTES)
      const buf = Buffer.alloc(len)
      fs.readSync(fd, buf, 0, len, 0)
      return estimateKvBytesPerTokenFromGgufBuffer(buf)
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return { kvBytesPerToken: FALLBACK_KV_BYTES_PER_TOKEN, source: 'fallback' }
  }
}

// ── VRAM budgeting ───────────────────────────────────────────────────────────

export const VRAM_HEADROOM_BYTES = 2 * 1024 ** 3
export const CTX_MIN_TOKENS = 4_096
export const CTX_ABSOLUTE_MAX_TOKENS = 262_144

/** Workload floor: inbox analyze (~6k prompt) + max_tokens 2048 + template overhead. */
export const MIN_CTX_PER_SLOT = 8_192

function parallelCandidates(requested: 1 | 2 | 4): readonly (1 | 2 | 4)[] {
  if (requested >= 4) return [4, 2, 1]
  if (requested >= 2) return [2, 1]
  return [1]
}

/**
 * Largest per-slot context that keeps >= 2 GB VRAM headroom given the quantized
 * model file size and KV bytes/token. Costs KV as parallel × per_slot × kv_bytes
 * (kv_unified=false worst case). Result is floored to a multiple of 1024.
 */
export function computeMaxCtxPerSlotForVram(p: {
  vramTotalBytes: number
  modelFileBytes: number
  kvBytesPerToken: number
  parallel: number
  trainedCtx?: number
  headroomBytes?: number
}): { maxCtxPerSlot: number; fits: boolean } {
  const headroom = p.headroomBytes ?? VRAM_HEADROOM_BYTES
  const perSlotOverhead = 64 * 1024 * 1024
  const parallel = Math.max(1, p.parallel)
  const budget = p.vramTotalBytes - p.modelFileBytes - headroom - parallel * perSlotOverhead
  const trainedCap = p.trainedCtx ?? CTX_ABSOLUTE_MAX_TOKENS
  const upper = Math.min(trainedCap, Math.floor(CTX_ABSOLUTE_MAX_TOKENS / parallel))
  if (budget <= 0 || p.kvBytesPerToken <= 0) {
    return { maxCtxPerSlot: Math.min(CTX_MIN_TOKENS, upper), fits: false }
  }
  const rawPerSlot = Math.floor(budget / (parallel * p.kvBytesPerToken))
  const floored = Math.floor(rawPerSlot / 1024) * 1024
  if (floored < CTX_MIN_TOKENS) {
    return { maxCtxPerSlot: Math.min(CTX_MIN_TOKENS, upper), fits: false }
  }
  return { maxCtxPerSlot: Math.min(floored, upper), fits: true }
}

/** @deprecated Use {@link computeMaxCtxPerSlotForVram}; returns global `--ctx-size` (= per_slot × parallel). */
export function computeMaxCtxForVram(p: {
  vramTotalBytes: number
  modelFileBytes: number
  kvBytesPerToken: number
  parallel: number
  trainedCtx?: number
  headroomBytes?: number
}): { maxCtx: number; fits: boolean } {
  const r = computeMaxCtxPerSlotForVram(p)
  return { maxCtx: r.maxCtxPerSlot * Math.max(1, p.parallel), fits: r.fits }
}

export interface SpawnContextBudget {
  parallelRequested: number
  parallelApplied: number
  ctxPerSlot: number
  /** llama-server `--ctx-size` (= ctxPerSlot × parallelApplied). */
  ctxGlobal: number
  ctxRequestedPerSlot: number
  ctxClamped: boolean
  parallelReduced: boolean
  belowFloor: boolean
}

/** Resolve per-slot ctx, auto-degrading parallel before dropping below {@link MIN_CTX_PER_SLOT}. */
export function resolveSpawnContextBudget(p: {
  config: LocalLlmServerConfig
  vramTotalBytes: number | null
  modelFileBytes: number | null
  kvBytesPerToken: number
  trainedCtx?: number
}): SpawnContextBudget {
  const parallelRequested = p.config.parallel
  const vramKnown =
    p.vramTotalBytes != null && p.modelFileBytes != null && p.vramTotalBytes > 0 && p.modelFileBytes > 0

  const perSlotForMode = (parallel: number): number => {
    const mode = p.config.ctxMode
    if (mode === 'standard') return LOCAL_LLM_CTX_STANDARD
    if (mode === 'long') return LOCAL_LLM_CTX_LONG
    if (vramKnown) {
      return computeMaxCtxPerSlotForVram({
        vramTotalBytes: p.vramTotalBytes!,
        modelFileBytes: p.modelFileBytes!,
        kvBytesPerToken: p.kvBytesPerToken,
        parallel,
        trainedCtx: p.trainedCtx,
      }).maxCtxPerSlot
    }
    return LOCAL_LLM_CTX_LONG
  }

  const ctxRequestedPerSlot = perSlotForMode(parallelRequested)

  if (!vramKnown) {
    const perSlot = ctxRequestedPerSlot
    return {
      parallelRequested,
      parallelApplied: parallelRequested,
      ctxPerSlot: perSlot,
      ctxGlobal: perSlot * parallelRequested,
      ctxRequestedPerSlot,
      ctxClamped: false,
      parallelReduced: false,
      belowFloor: perSlot < MIN_CTX_PER_SLOT,
    }
  }

  for (const parallel of parallelCandidates(parallelRequested)) {
    let perSlot = perSlotForMode(parallel)
    const affordable = computeMaxCtxPerSlotForVram({
      vramTotalBytes: p.vramTotalBytes!,
      modelFileBytes: p.modelFileBytes!,
      kvBytesPerToken: p.kvBytesPerToken,
      parallel,
      trainedCtx: p.trainedCtx,
    }).maxCtxPerSlot
    let ctxClamped = false
    if (perSlot > affordable) {
      perSlot = affordable
      ctxClamped = true
    }
    if (perSlot >= MIN_CTX_PER_SLOT) {
      const requestedAtParallel = perSlotForMode(parallel)
      return {
        parallelRequested,
        parallelApplied: parallel,
        ctxPerSlot: perSlot,
        ctxGlobal: perSlot * parallel,
        ctxRequestedPerSlot,
        ctxClamped: ctxClamped || perSlot < requestedAtParallel,
        parallelReduced: parallel < parallelRequested,
        belowFloor: false,
      }
    }
  }

  const perSlot = Math.max(
    CTX_MIN_TOKENS,
    computeMaxCtxPerSlotForVram({
      vramTotalBytes: p.vramTotalBytes!,
      modelFileBytes: p.modelFileBytes!,
      kvBytesPerToken: p.kvBytesPerToken,
      parallel: 1,
      trainedCtx: p.trainedCtx,
    }).maxCtxPerSlot,
  )
  return {
    parallelRequested,
    parallelApplied: 1,
    ctxPerSlot: perSlot,
    ctxGlobal: perSlot,
    ctxRequestedPerSlot,
    ctxClamped: true,
    parallelReduced: parallelRequested > 1,
    belowFloor: perSlot < MIN_CTX_PER_SLOT,
  }
}

/** nvidia-smi VRAM used/total in bytes (null when no NVIDIA GPU / tool missing). */
export async function queryNvidiaVramUsage(): Promise<{
  usedBytes: number
  totalBytes: number
} | null> {
  try {
    const { stdout } = await execAsync(
      'nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits',
      { timeout: 8_000, windowsHide: true },
    )
    let best: { usedBytes: number; totalBytes: number } | null = null
    for (const line of stdout.split(/\r?\n/)) {
      const m = line.trim().match(/^(\d+)\s*,\s*(\d+)$/)
      if (!m) continue
      const used = parseInt(m[1], 10) * 1024 ** 2
      const total = parseInt(m[2], 10) * 1024 ** 2
      if (!best || total > best.totalBytes) best = { usedBytes: used, totalBytes: total }
    }
    return best
  } catch {
    return null
  }
}

// ── --help flag verification ─────────────────────────────────────────────────

/**
 * Extract the set of long-form flags (`--foo-bar`) the installed binary
 * advertises in its `--help` output, plus the raw help text for value-style
 * detection.
 */
export function parseSupportedFlagsFromHelp(helpText: string): Set<string> {
  const flags = new Set<string>()
  const re = /--[a-z0-9][a-z0-9-]*/gi
  for (const m of helpText.matchAll(re)) {
    flags.add(m[0].toLowerCase())
  }
  return flags
}

/**
 * `--flash-attn` shifted from a boolean switch to an enum (`on|off|auto`) across
 * llama.cpp releases. Detect from the help text whether it takes a value.
 */
export function flashAttnTakesValue(helpText: string): boolean {
  const line = helpText
    .split(/\r?\n/)
    .find((l) => l.includes('--flash-attn'))
  if (!line) return false
  return /--flash-attn[^\n]*\b(on|off|auto)\b/i.test(line) || /--flash-attn\s+[<[]/.test(line)
}

export interface ResolvedSpawnPlan {
  args: string[]
  /** Global `--ctx-size` (= ctxPerSlot × parallelApplied). */
  ctxTokens: number
  ctxPerSlot: number
  ctxGlobal: number
  ctxClamped: boolean
  ctxRequestedPerSlot: number
  parallelRequested: number
  parallelApplied: number
  parallelReduced: boolean
  unsupportedFlags: string[]
  reasoningEnabled: boolean
  /** Applied parallel (alias for parallelApplied). */
  parallel: number
}

/**
 * Build the final spawn argv for llama-server. Managed flags absent from the
 * binary's --help are omitted (logged by the caller via `unsupportedFlags`).
 */
export function buildLlamaServerArgs(p: {
  ggufPath: string
  port: number
  config: LocalLlmServerConfig
  helpText: string
  spawnBudget: SpawnContextBudget
}): ResolvedSpawnPlan {
  const supported = parseSupportedFlagsFromHelp(p.helpText)
  const unsupportedFlags: string[] = []
  const args: string[] = ['--host', '127.0.0.1', '--port', String(p.port), '-m', p.ggufPath]

  const pushIfSupported = (flag: string, value?: string): void => {
    if (!supported.has(flag)) {
      unsupportedFlags.push(flag)
      return
    }
    args.push(flag)
    if (value !== undefined) args.push(value)
  }

  // Full GPU offload — llama-server clamps to the model's layer count. `-ngl` is the
  // short form; support is detected via its long aliases in the help text.
  if (supported.has('--n-gpu-layers') || supported.has('--gpu-layers')) {
    args.push('-ngl', '999')
  } else {
    unsupportedFlags.push('-ngl')
  }
  pushIfSupported('--jinja')

  const budget = p.spawnBudget
  pushIfSupported('--ctx-size', String(budget.ctxGlobal))
  pushIfSupported('--parallel', String(budget.parallelApplied))

  if (supported.has('--flash-attn')) {
    if (flashAttnTakesValue(p.helpText)) {
      args.push('--flash-attn', 'on')
    } else {
      args.push('--flash-attn')
    }
  } else {
    unsupportedFlags.push('--flash-attn')
  }

  pushIfSupported('--reasoning-budget', p.config.reasoningEnabled ? '-1' : '0')

  return {
    args,
    ctxTokens: budget.ctxGlobal,
    ctxPerSlot: budget.ctxPerSlot,
    ctxGlobal: budget.ctxGlobal,
    ctxClamped: budget.ctxClamped,
    ctxRequestedPerSlot: budget.ctxRequestedPerSlot,
    parallelRequested: budget.parallelRequested,
    parallelApplied: budget.parallelApplied,
    parallelReduced: budget.parallelReduced,
    unsupportedFlags,
    reasoningEnabled: p.config.reasoningEnabled,
    parallel: budget.parallelApplied,
  }
}

/** Run `<binary> --help` and return its output (stdout+stderr merged). */
export async function readLlamaServerHelpText(binaryPath: string): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(`"${binaryPath}" --help`, {
      timeout: 15_000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    })
    return `${stdout}\n${stderr}`
  } catch (e) {
    // Some builds exit non-zero on --help; the output is still attached to the error.
    const err = e as { stdout?: string; stderr?: string }
    const out = `${err.stdout ?? ''}\n${err.stderr ?? ''}`.trim()
    if (out) return out
    throw e
  }
}

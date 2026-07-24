/**
 * build039 spawn-arg resolution tests:
 *  - per-slot VRAM budgeting (kv_unified=false: global ctx = per_slot × parallel)
 *  - parallel auto-degrade before dropping below MIN_CTX_PER_SLOT
 *  - --help flag verification
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
}))

import {
  buildLlamaServerArgs,
  computeMaxCtxForVram,
  computeMaxCtxPerSlotForVram,
  estimateKvBytesPerTokenFromGgufBuffer,
  FALLBACK_KV_BYTES_PER_TOKEN,
  flashAttnTakesValue,
  MIN_CTX_PER_SLOT,
  parseSupportedFlagsFromHelp,
  resolveSpawnContextBudget,
  CTX_MIN_TOKENS,
} from '../llamaServerArgs'
import { DEFAULT_LOCAL_LLM_SERVER_CONFIG } from '../localLlmServerConfig'

const FULL_HELP = `
usage: llama-server [options]

-m,    --model FNAME                  model path
-ngl,  --gpu-layers, --n-gpu-layers N number of layers to store in VRAM
       --host HOST                    ip address to listen
       --port PORT                    port to listen
-c,    --ctx-size N                   size of the prompt context
-np,   --parallel N                   number of parallel sequences to decode
-fa,   --flash-attn [on|off|auto]     set Flash Attention use ('on', 'off', or 'auto', default: 'auto')
       --jinja                        use jinja template for chat
       --reasoning-budget N           controls the amount of thinking allowed
`

const OLD_HELP_NO_REASONING = `
usage: llama-server [options]

-m,    --model FNAME                  model path
-ngl,  --n-gpu-layers N               number of layers to store in VRAM
       --host HOST                    ip address
       --port PORT                    port
-c,    --ctx-size N                   size of the prompt context
-np,   --parallel N                   number of parallel sequences to decode
-fa,   --flash-attn                   enable Flash Attention (default: disabled)
`

function spawnBudget(overrides: Partial<Parameters<typeof resolveSpawnContextBudget>[0]> = {}) {
  return resolveSpawnContextBudget({
    config: { ...DEFAULT_LOCAL_LLM_SERVER_CONFIG },
    vramTotalBytes: null,
    modelFileBytes: null,
    kvBytesPerToken: FALLBACK_KV_BYTES_PER_TOKEN,
    ...overrides,
  })
}

describe('parseSupportedFlagsFromHelp', () => {
  it('collects long-form flags', () => {
    const flags = parseSupportedFlagsFromHelp(FULL_HELP)
    expect(flags.has('--ctx-size')).toBe(true)
    expect(flags.has('--parallel')).toBe(true)
    expect(flags.has('--jinja')).toBe(true)
    expect(flags.has('--reasoning-budget')).toBe(true)
    expect(flags.has('--n-gpu-layers')).toBe(true)
    expect(flags.has('--nonexistent')).toBe(false)
  })
})

describe('flashAttnTakesValue', () => {
  it('detects the enum form', () => {
    expect(flashAttnTakesValue(FULL_HELP)).toBe(true)
  })
  it('detects the plain switch form', () => {
    expect(flashAttnTakesValue(OLD_HELP_NO_REASONING)).toBe(false)
  })
})

describe('buildLlamaServerArgs', () => {
  const base = {
    ggufPath: '/models/test.gguf',
    port: 8080,
    config: { ...DEFAULT_LOCAL_LLM_SERVER_CONFIG },
    spawnBudget: spawnBudget(),
  }

  it('emits per-slot × parallel as global --ctx-size (Standard preset)', () => {
    const plan = buildLlamaServerArgs({ ...base, helpText: FULL_HELP })
    expect(plan.args).toEqual([
      '--host', '127.0.0.1',
      '--port', '8080',
      '-m', '/models/test.gguf',
      '-ngl', '999',
      '--jinja',
      '--ctx-size', '32768',
      '--parallel', '4',
      '--flash-attn', 'on',
      '--reasoning-budget', '0',
    ])
    expect(plan.ctxPerSlot).toBe(8192)
    expect(plan.ctxGlobal).toBe(32768)
    expect(plan.unsupportedFlags).toEqual([])
    expect(plan.ctxClamped).toBe(false)
  })

  it('omits flags the installed binary does not advertise (never passes unknown flags)', () => {
    const plan = buildLlamaServerArgs({ ...base, helpText: OLD_HELP_NO_REASONING })
    expect(plan.args).not.toContain('--reasoning-budget')
    expect(plan.args).not.toContain('--jinja')
    expect(plan.unsupportedFlags).toContain('--reasoning-budget')
    expect(plan.unsupportedFlags).toContain('--jinja')
    const faIdx = plan.args.indexOf('--flash-attn')
    expect(faIdx).toBeGreaterThan(-1)
    expect(plan.args[faIdx + 1]).not.toBe('on')
  })

  it('maps reasoningEnabled to --reasoning-budget -1', () => {
    const plan = buildLlamaServerArgs({
      ...base,
      helpText: FULL_HELP,
      config: { ...base.config, reasoningEnabled: true },
    })
    const idx = plan.args.indexOf('--reasoning-budget')
    expect(plan.args[idx + 1]).toBe('-1')
  })

  it('applies spawn budget parallel and global ctx from VRAM resolution', () => {
    const budget = resolveSpawnContextBudget({
      config: { ...DEFAULT_LOCAL_LLM_SERVER_CONFIG, ctxMode: 'long', parallel: 4 },
      vramTotalBytes: 16 * 1024 ** 3,
      modelFileBytes: 7.4 * 1024 ** 3,
      kvBytesPerToken: 196_608,
    })
    const plan = buildLlamaServerArgs({ ...base, helpText: FULL_HELP, spawnBudget: budget })
    expect(plan.ctxPerSlot).toBeGreaterThanOrEqual(MIN_CTX_PER_SLOT)
    expect(plan.ctxGlobal).toBe(plan.ctxPerSlot * plan.parallelApplied)
    const idx = plan.args.indexOf('--ctx-size')
    expect(plan.args[idx + 1]).toBe(String(plan.ctxGlobal))
  })
})

describe('computeMaxCtxPerSlotForVram', () => {
  const GiB = 1024 ** 3

  it('budgets per-slot from parallel × per_slot × kv (kv_unified=false)', () => {
    const r = computeMaxCtxPerSlotForVram({
      vramTotalBytes: 16 * GiB,
      modelFileBytes: 7.4 * GiB,
      kvBytesPerToken: 196_608,
      parallel: 4,
    })
    expect(r.fits).toBe(true)
    expect(r.maxCtxPerSlot % 1024).toBe(0)
    expect(r.maxCtxPerSlot).toBeGreaterThan(8_000)
    expect(r.maxCtxPerSlot).toBeLessThan(12_000)
    const legacy = computeMaxCtxForVram({
      vramTotalBytes: 16 * GiB,
      modelFileBytes: 7.4 * GiB,
      kvBytesPerToken: 196_608,
      parallel: 4,
    })
    expect(legacy.maxCtx).toBe(r.maxCtxPerSlot * 4)
  })

  it('caps at the model trained context per slot', () => {
    const r = computeMaxCtxPerSlotForVram({
      vramTotalBytes: 48 * GiB,
      modelFileBytes: 4 * GiB,
      kvBytesPerToken: 65_536,
      parallel: 1,
      trainedCtx: 32_768,
    })
    expect(r.maxCtxPerSlot).toBe(32_768)
  })

  it('reports non-fit but floors at minimum when the model barely fits', () => {
    const r = computeMaxCtxPerSlotForVram({
      vramTotalBytes: 8 * GiB,
      modelFileBytes: 7.5 * GiB,
      kvBytesPerToken: 196_608,
      parallel: 4,
    })
    expect(r.fits).toBe(false)
    expect(r.maxCtxPerSlot).toBe(CTX_MIN_TOKENS)
  })
})

describe('resolveSpawnContextBudget', () => {
  const GiB = 1024 ** 3
  const hostVram = 16 * GiB
  const model12bQ4 = 7.4 * GiB
  const kvPerToken = 196_608

  it('Standard + parallel 4 on 16GB yields per-slot >= 8192', () => {
    const b = resolveSpawnContextBudget({
      config: { ...DEFAULT_LOCAL_LLM_SERVER_CONFIG, ctxMode: 'standard', parallel: 4 },
      vramTotalBytes: hostVram,
      modelFileBytes: model12bQ4,
      kvBytesPerToken: kvPerToken,
    })
    expect(b.ctxPerSlot).toBeGreaterThanOrEqual(MIN_CTX_PER_SLOT)
    expect(b.ctxGlobal).toBe(b.ctxPerSlot * b.parallelApplied)
    expect(b.parallelApplied).toBe(4)
    expect(b.parallelReduced).toBe(false)
  })

  it('auto-degrades parallel 4→2→1 before dropping per-slot below floor', () => {
    const moderateVram = 14 * GiB
    const b = resolveSpawnContextBudget({
      config: { ...DEFAULT_LOCAL_LLM_SERVER_CONFIG, ctxMode: 'standard', parallel: 4 },
      vramTotalBytes: moderateVram,
      modelFileBytes: model12bQ4,
      kvBytesPerToken: kvPerToken,
    })
    expect(b.ctxPerSlot).toBeGreaterThanOrEqual(MIN_CTX_PER_SLOT)
    expect(b.parallelApplied).toBeLessThan(4)
    expect(b.parallelReduced).toBe(true)
  })

  it('5086-token inbox prompt fits Standard spawn plan prompt budget', () => {
    const b = resolveSpawnContextBudget({
      config: { ...DEFAULT_LOCAL_LLM_SERVER_CONFIG, ctxMode: 'standard', parallel: 4 },
      vramTotalBytes: hostVram,
      modelFileBytes: model12bQ4,
      kvBytesPerToken: kvPerToken,
    })
    const promptTokens = 5086
    const maxOut = 2048
    const overhead = 256
    expect(promptTokens + maxOut + overhead).toBeLessThanOrEqual(b.ctxPerSlot)
  })
})

// ── Synthetic GGUF header ────────────────────────────────────────────────────

function ggufString(s: string): Buffer {
  const b = Buffer.from(s, 'utf8')
  const len = Buffer.alloc(8)
  len.writeBigUInt64LE(BigInt(b.length))
  return Buffer.concat([len, b])
}

function ggufKvU32(key: string, value: number): Buffer {
  const type = Buffer.alloc(4)
  type.writeUInt32LE(4)
  const v = Buffer.alloc(4)
  v.writeUInt32LE(value)
  return Buffer.concat([ggufString(key), type, v])
}

function ggufKvString(key: string, value: string): Buffer {
  const type = Buffer.alloc(4)
  type.writeUInt32LE(8)
  return Buffer.concat([ggufString(key), type, ggufString(value)])
}

function buildSyntheticGguf(kvs: Buffer[]): Buffer {
  const head = Buffer.alloc(24)
  head.writeUInt32LE(0x46554747, 0)
  head.writeUInt32LE(3, 4)
  head.writeBigUInt64LE(0n, 8)
  head.writeBigUInt64LE(BigInt(kvs.length), 16)
  return Buffer.concat([head, ...kvs])
}

describe('estimateKvBytesPerTokenFromGgufBuffer', () => {
  it('derives kv/token from block_count, embedding, and KV head count', () => {
    const buf = buildSyntheticGguf([
      ggufKvString('general.architecture', 'gemma4'),
      ggufKvU32('gemma4.block_count', 48),
      ggufKvU32('gemma4.embedding_length', 3840),
      ggufKvU32('gemma4.attention.head_count', 16),
      ggufKvU32('gemma4.attention.head_count_kv', 8),
      ggufKvU32('gemma4.context_length', 131072),
    ])
    const est = estimateKvBytesPerTokenFromGgufBuffer(buf)
    expect(est.source).toBe('gguf')
    expect(est.kvBytesPerToken).toBe(2 * 48 * 8 * 240 * 2)
    expect(est.trainedCtx).toBe(131072)
  })

  it('falls back safely on a non-GGUF buffer', () => {
    const est = estimateKvBytesPerTokenFromGgufBuffer(Buffer.from('not a gguf file at all'))
    expect(est.source).toBe('fallback')
    expect(est.kvBytesPerToken).toBe(FALLBACK_KV_BYTES_PER_TOKEN)
  })
})

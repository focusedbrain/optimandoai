/**
 * build038 spawn-arg resolution tests:
 *  - --help flag verification (unsupported flags omitted, never passed)
 *  - --flash-attn switch vs. enum detection across llama.cpp releases
 *  - VRAM-fit ctx computation from model file size + GGUF KV metadata
 *  - ctx clamp when the configured value does not fit
 *  - GGUF header parsing for KV bytes/token (synthetic file, no hardcoded model numbers)
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
}))

import {
  buildLlamaServerArgs,
  computeMaxCtxForVram,
  estimateKvBytesPerTokenFromGgufBuffer,
  FALLBACK_KV_BYTES_PER_TOKEN,
  flashAttnTakesValue,
  parseSupportedFlagsFromHelp,
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
    maxCtxTokens: null as number | null,
  }

  it('emits all managed flags when the binary supports them', () => {
    const plan = buildLlamaServerArgs({ ...base, helpText: FULL_HELP })
    expect(plan.args).toEqual([
      '--host', '127.0.0.1',
      '--port', '8080',
      '-m', '/models/test.gguf',
      '-ngl', '999',
      '--jinja',
      '--ctx-size', '16384',
      '--parallel', '4',
      '--flash-attn', 'on',
      '--reasoning-budget', '0',
    ])
    expect(plan.unsupportedFlags).toEqual([])
    expect(plan.ctxClamped).toBe(false)
  })

  it('omits flags the installed binary does not advertise (never passes unknown flags)', () => {
    const plan = buildLlamaServerArgs({ ...base, helpText: OLD_HELP_NO_REASONING })
    expect(plan.args).not.toContain('--reasoning-budget')
    expect(plan.args).not.toContain('--jinja')
    expect(plan.unsupportedFlags).toContain('--reasoning-budget')
    expect(plan.unsupportedFlags).toContain('--jinja')
    // switch-style flash-attn: bare flag, no value
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

  it('clamps ctx to the VRAM-fit ceiling and reports it', () => {
    const plan = buildLlamaServerArgs({
      ...base,
      helpText: FULL_HELP,
      config: { ...base.config, ctxMode: 'long' }, // requests 32768
      maxCtxTokens: 20_480,
    })
    expect(plan.ctxTokens).toBe(20_480)
    expect(plan.ctxRequested).toBe(32_768)
    expect(plan.ctxClamped).toBe(true)
    const idx = plan.args.indexOf('--ctx-size')
    expect(plan.args[idx + 1]).toBe('20480')
  })

  it("falls back to the 'long' preset when 'max' is selected but VRAM is unknown", () => {
    const plan = buildLlamaServerArgs({
      ...base,
      helpText: FULL_HELP,
      config: { ...base.config, ctxMode: 'max' },
      maxCtxTokens: null,
    })
    expect(plan.ctxTokens).toBe(32_768)
    expect(plan.ctxClamped).toBe(false)
  })

  it("resolves 'max' mode to the computed ceiling without flagging a clamp", () => {
    const plan = buildLlamaServerArgs({
      ...base,
      helpText: FULL_HELP,
      config: { ...base.config, ctxMode: 'max' },
      maxCtxTokens: 49_152,
    })
    expect(plan.ctxTokens).toBe(49_152)
    expect(plan.ctxClamped).toBe(false)
  })
})

describe('computeMaxCtxForVram', () => {
  const GiB = 1024 ** 3

  it('budgets from actual model size + kv/token with 2GB headroom', () => {
    // 16 GiB VRAM, 7.4 GiB model, ~192 KiB/token KV → ~ (16-7.4-2-0.25) GiB / 192KiB ≈ 34.6k tokens
    const r = computeMaxCtxForVram({
      vramTotalBytes: 16 * GiB,
      modelFileBytes: 7.4 * GiB,
      kvBytesPerToken: 196_608,
      parallel: 4,
    })
    expect(r.fits).toBe(true)
    expect(r.maxCtx % 1024).toBe(0)
    expect(r.maxCtx).toBeGreaterThan(30_000)
    expect(r.maxCtx).toBeLessThan(40_000)
  })

  it('caps at the model trained context', () => {
    const r = computeMaxCtxForVram({
      vramTotalBytes: 48 * GiB,
      modelFileBytes: 4 * GiB,
      kvBytesPerToken: 65_536,
      parallel: 1,
      trainedCtx: 32_768,
    })
    expect(r.maxCtx).toBe(32_768)
  })

  it('reports non-fit but floors at the minimum ctx when the model barely fits', () => {
    const r = computeMaxCtxForVram({
      vramTotalBytes: 8 * GiB,
      modelFileBytes: 7.5 * GiB,
      kvBytesPerToken: 196_608,
      parallel: 4,
    })
    expect(r.fits).toBe(false)
    expect(r.maxCtx).toBe(CTX_MIN_TOKENS)
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
  type.writeUInt32LE(4) // UINT32
  const v = Buffer.alloc(4)
  v.writeUInt32LE(value)
  return Buffer.concat([ggufString(key), type, v])
}

function ggufKvString(key: string, value: string): Buffer {
  const type = Buffer.alloc(4)
  type.writeUInt32LE(8) // STRING
  return Buffer.concat([ggufString(key), type, ggufString(value)])
}

function buildSyntheticGguf(kvs: Buffer[]): Buffer {
  const head = Buffer.alloc(24)
  head.writeUInt32LE(0x46554747, 0) // 'GGUF'
  head.writeUInt32LE(3, 4) // version
  head.writeBigUInt64LE(0n, 8) // tensor count
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
    // head_dim = 3840/16 = 240; kv/token = 2 (K+V) * 48 layers * 8 kv-heads * 240 * 2 bytes
    expect(est.kvBytesPerToken).toBe(2 * 48 * 8 * 240 * 2)
    expect(est.trainedCtx).toBe(131072)
  })

  it('falls back safely on a non-GGUF buffer', () => {
    const est = estimateKvBytesPerTokenFromGgufBuffer(Buffer.from('not a gguf file at all'))
    expect(est.source).toBe('fallback')
    expect(est.kvBytesPerToken).toBe(FALLBACK_KV_BYTES_PER_TOKEN)
  })
})

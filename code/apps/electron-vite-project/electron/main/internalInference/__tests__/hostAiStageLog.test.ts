import { describe, expect, it, vi, afterEach } from 'vitest'
import { hostAiP2pFlagsForLog, logHostAiStage } from '../hostAiStageLog'
import { getP2pInferenceFlags, resetP2pInferenceFlagsForTests } from '../p2pInferenceFlags'

afterEach(() => {
  vi.unstubAllEnvs()
  resetP2pInferenceFlagsForTests()
  vi.restoreAllMocks()
})

describe('hostAiStageLog', () => {
  it('does not emit [HOST_AI_STAGE] when WRDESK_P2P_INFERENCE_VERBOSE_LOGS is off', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const f = getP2pInferenceFlags()
    logHostAiStage({
      chain: 'c1',
      stage: 'feature_flags',
      reached: true,
      success: true,
      handshakeId: 'hs-1',
      buildStamp: 'b',
      flags: f,
    })
    expect(log).not.toHaveBeenCalled()
  })

  it('emits [HOST_AI_STAGE] with chain, build, and flags when verbose logs on (no body content)', () => {
    vi.stubEnv('WRDESK_P2P_INFERENCE_VERBOSE_LOGS', '1')
    resetP2pInferenceFlagsForTests()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const f = getP2pInferenceFlags()
    logHostAiStage({
      chain: 'cafe-babe-0000-0000-00000000beef',
      stage: 'feature_flags',
      reached: true,
      success: true,
      handshakeId: 'hs-1',
      buildStamp: 'test-build',
      flags: f,
    })
    expect(log).toHaveBeenCalledOnce()
    const line = String(log.mock.calls[0][0])
    expect(line).toMatch(/^\[HOST_AI_STAGE\]/)
    expect(line).toContain('chain=cafe-babe-0000-0000-00000000beef')
    expect(line).toContain('build=test-build')
    expect(line).toContain('flags=')
    expect(line).toContain(`flags=${hostAiP2pFlagsForLog(f)}`)
    expect(line).not.toMatch(/password|Bearer\s+\S{20,}/i)
  })
})
